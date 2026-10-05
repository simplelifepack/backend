import { packageInputSchema } from "../ai/packageInput";
import { buildErrorResponse } from "../middleware/errorHandling";
import type { ProviderRequestOptions } from "../ai/providers/types";
import { performance } from "node:perf_hooks";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AIUnavailableError, PackageGenerationRejectedError, analyzeIntent } from "../ai/analyzeIntent";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { createCustomPack, deleteCustomPack, getPackageDefinitions, getReadinessPackDefinitionBySlug, getReadinessPackDefinitionBySlugForUser, getReadinessPacksBySlugs, listPackageSummaries, type PackageListTiming, updateCustomPack } from "../services/packs.service";
import { createCustomPackageGenerationJob, getAndMaybeProcessCustomPackageGenerationJob } from "../services/customPackageGenerationQueue.service";
import { findDefaultPackMatch, saveGeneratedDefaultPack } from "../services/readiness/defaultPacksRepository";
import { refreshPackageForUser } from "../services/readiness/packageRefresh.service";
import { PackageRefreshError } from "../ai/researchPackageRefresh";

const router = Router();
router.use(requireAuth);

const slugSchema = z.object({
  slug: z.string().trim().min(1),
});
const assignmentParamsSchema = z.object({
  requirementId: z.string().trim().min(1),
  slug: z.string().trim().min(1),
});
const assignmentSchema = z.object({
  assignmentSource: z.enum(["USER_SELECTED", "USER_OVERRIDE"]),
  documentId: z.string().trim().min(1),
});

const searchSchema = z.object({ q: z.string().trim().min(1).max(160) });
const idsSchema = z.object({ ids: z.string().trim().min(1).max(500) });
const generationJobParamsSchema = z.object({ jobId: z.string().trim().min(1) });
const listSchema = z.object({
  category: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).catch(200),
  location: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).catch(1),
  provider: z.string().trim().min(1).max(80).optional(),
  search: z.string().trim().min(1).max(160).optional(),
  sort: z.enum(["category", "newest", "relevance", "title"]).catch("category"),
});
const searchOrGenerateSchema = packageInputSchema;
const customPackSchema = z.object({
  description: z.string().trim().max(1000).optional(),
  requirements: z.array(z.string().trim().min(1).max(120)).min(1).max(40),
  searchMetadata: z.record(z.string(), z.unknown()).optional(),
  source: z.object({
    name: z.string().trim().max(160).optional(),
    title: z.string().trim().max(200).optional(),
    url: z.string().trim().url().max(500).optional(),
    lastCheckedAt: z.string().trim().max(40).optional(),
  }).optional(),
  title: z.string().trim().min(1).max(120),
  verificationSources: z.array(z.unknown()).max(10).optional(),
  verificationStatus: z.string().trim().max(80).optional(),
}).strict();

type Generation = {
  promise: Promise<string>;
  controller: AbortController;
  listeners: Set<(delta: string) => void>;
  subscribers: number;
  text: string;
};
const inFlightPackageGenerations = new Map<string, Generation>();

async function generateAndSavePackage(userId: string, packageType: string, documentLabels: string[], options: ProviderRequestOptions) {
  const key = JSON.stringify({ userId, packageType, documentLabels: [...new Set(documentLabels)].sort() });
  let entry = inFlightPackageGenerations.get(key);
  if (!entry) {
    const controller = new AbortController();
    const listeners = new Set<(delta: string) => void>();
    const created: Generation = { controller, listeners, subscribers: 0, text: "", promise: Promise.resolve("") };
    created.promise = analyzeIntent(userId, { packageType, documentLabels }, {
      signal: controller.signal,
      ...(options.onDelta ? { onDelta: (delta: string) => {
        created.text += delta;
        for (const listener of listeners) listener(delta);
      } } : {}),
    }).then(generated => saveGeneratedDefaultPack(packageType, generated))
      .finally(() => inFlightPackageGenerations.delete(key));
    inFlightPackageGenerations.set(key, created);
    entry = created;
  }
  const current = entry;
  current.subscribers += 1;
  if (options.onDelta) { current.listeners.add(options.onDelta); if (current.text) options.onDelta(current.text); }
  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    if (options.onDelta) current.listeners.delete(options.onDelta);
    if (--current.subscribers === 0) current.controller.abort();
  };
  options.signal?.addEventListener("abort", detach, { once: true });
  if (options.signal?.aborted) detach();
  try { return await current.promise; }
  finally { options.signal?.removeEventListener("abort", detach); detach(); }
}

router.get("/search", async (req, res, next) => {
  try {
    const { q } = searchSchema.parse(req.query);
    const match = await findDefaultPackMatch(q);
    if (!match) return res.json([]);
    const pack = await getReadinessPackDefinitionBySlug(match.slug);
    return res.json(pack ? [pack] : []);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Package search must be 160 characters or fewer." });
    }
    return next(error);
  }
});

router.post("/search-or-generate", async (req, res, next) => {
  const controller = new AbortController();
  const streaming = req.get("Accept")?.includes("text/event-stream");
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", disconnect);
  const send = (event: string, data: unknown) => {
    if (controller.signal.aborted || res.destroyed) return;
    if (res.writableLength > 1_000_000) { controller.abort(); res.destroy(); return; }
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
    }
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { packageType, documentLabels } = searchOrGenerateSchema.parse(req.body);
    const query = packageType;
    const existing = await findDefaultPackMatch(query);
    const shouldGenerate = !existing;
    const source = shouldGenerate ? "official_source" : "existing";
    const slug = shouldGenerate
      ? await generateAndSavePackage(authUser.id, packageType, documentLabels, { signal: controller.signal, ...(streaming ? { onDelta: (text: string) => send("delta", { text }) } : {}) })
      : existing.slug;
    const packageDefinition = await getReadinessPackDefinitionBySlug(slug);

    if (!packageDefinition) {
      return res.status(404).json({ message: "Package could not be loaded." });
    }

    const result = {
      source,
      confidence: existing?.confidence ?? null,
      matchReason: existing?.reason ?? null,
      package: packageDefinition,
    };
    if (controller.signal.aborted) return;
    if (streaming) { send("result", result); return res.end(); }
    return res.json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (res.headersSent) {
      const response = buildErrorResponse({ error, production: true });
      send("error", response.body);
      return res.end();
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Package search must be 160 characters or fewer." });
    }
    if (error instanceof AIUnavailableError || error instanceof PackageGenerationRejectedError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  } finally { res.off("close", disconnect); }
});

router.post("/custom/draft", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const job = await createCustomPackageGenerationJob(authUser.id, req.body);
    const processed = await getAndMaybeProcessCustomPackageGenerationJob(authUser.id, job.id);
    if (!processed) return res.status(404).json({ message: "Package generation job not found." });
    if (processed.draft) return res.json({ draft: processed.draft, job: processed });
    return res.status(202).json({ job: processed });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Package description must be 160 characters or fewer." });
    }
    if (error instanceof AIUnavailableError || error instanceof PackageGenerationRejectedError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.post("/custom/generation-jobs", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const job = await createCustomPackageGenerationJob(authUser.id, req.body);
    return res.status(202).json({ job });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Package description must be 160 characters or fewer." });
    return next(error);
  }
});

router.get("/custom/generation-jobs/:jobId", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { jobId } = generationJobParamsSchema.parse(req.params);
    const job = await getAndMaybeProcessCustomPackageGenerationJob(authUser.id, jobId);
    if (!job) return res.status(404).json({ message: "Package generation job not found." });
    return res.json({ job });
  } catch (error) {
    return next(error);
  }
});

router.post("/custom", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const input = customPackSchema.parse(req.body);
    const pack = await createCustomPack(authUser.id, input);
    return res.status(201).json({ package: pack });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Custom pack name and document list are required." });
    return next(error);
  }
});

router.patch("/:slug/custom", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { slug } = slugSchema.parse(req.params);
    const input = customPackSchema.parse(req.body);
    const pack = await updateCustomPack(authUser.id, slug, input);
    if (!pack) return res.status(404).json({ message: "Custom pack not found." });
    return res.json({ package: pack });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Custom pack name and document list are required." });
    return next(error);
  }
});

router.delete("/:slug/custom", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { slug } = slugSchema.parse(req.params);
    const deleted = await deleteCustomPack(authUser.id, slug);
    if (!deleted) return res.status(404).json({ message: "Custom pack not found." });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.post("/:slug/refresh", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { slug } = slugSchema.parse(req.params);
    const result = await refreshPackageForUser(authUser.id, slug);
    res.setHeader("Cache-Control", "no-store");
    return res.json(result);
  } catch (error) {
    if (error instanceof PackageRefreshError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { slug } = slugSchema.parse(req.params);
    const pack = await getReadinessPackDefinitionBySlugForUser(slug, authUser.id);
    if (!pack) {
      return res.status(404).json({ message: "Pack not found." });
    }
    return res.json(pack);
  } catch (error) {
    return next(error);
  }
});

router.post("/:slug/requirements/:requirementId/assignment", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { slug, requirementId } = assignmentParamsSchema.parse(req.params);
    const { assignmentSource, documentId } = assignmentSchema.parse(req.body);
    const pack = await getReadinessPackDefinitionBySlugForUser(slug, authUser.id);
    const requirement = pack?.requirements.find((item) => item.id === requirementId);
    if (!pack || !requirement) return res.status(404).json({ message: "Requirement not found." });
    const document = await prisma.document.findFirst({
      where: { id: documentId, ownerProfileId: authUser.id, deletedAt: null },
      select: { id: true },
    });
    if (!document) return res.status(404).json({ message: "Document not found." });
    await prisma.requirementAssignment.upsert({
      where: { userId_requirementId: { userId: authUser.id, requirementId } },
      create: {
        userId: authUser.id,
        requirementId,
        documentId,
        assignmentSource,
        overriddenAt: assignmentSource === "USER_OVERRIDE" ? new Date() : null,
      },
      update: {
        documentId,
        assignmentSource,
        overriddenAt: assignmentSource === "USER_OVERRIDE" ? new Date() : null,
      },
    });
    return res.json({ package: await getReadinessPackDefinitionBySlugForUser(pack.slug, authUser.id) });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:slug/requirements/:requirementId/assignment", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { slug, requirementId } = assignmentParamsSchema.parse(req.params);
    const pack = await getReadinessPackDefinitionBySlugForUser(slug, authUser.id);
    if (!pack?.requirements.some((item) => item.id === requirementId)) {
      return res.status(404).json({ message: "Requirement not found." });
    }
    await prisma.requirementAssignment.deleteMany({ where: { userId: authUser.id, requirementId } });
    return res.json({ package: await getReadinessPackDefinitionBySlugForUser(pack.slug, authUser.id) });
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    if (typeof _req.query.ids === "string") {
      const { ids } = idsSchema.parse(_req.query);
      return res.json(await getReadinessPacksBySlugs(ids.split(",")));
    }
    if (_req.baseUrl === "/api/packages") {
      const { authUser } = _req as unknown as AuthenticatedRequest;
      const options = listSchema.parse(_req.query);
      const timingEnabled = _req.get("x-readiness-timing") === "1";
      const timing: PackageListTiming | undefined = timingEnabled ? {} : undefined;
      const serviceStartMs = performance.now();
      const response = await listPackageSummaries({
        ...options,
        userId: authUser.id,
      }, timing);
      if (!timingEnabled) return res.json(response);
      const serializeStartMs = performance.now();
      const body = JSON.stringify(response);
      const serializationMs = performance.now() - serializeStartMs;
      const authTiming = (_req as unknown as AuthenticatedRequest).authTiming;
      const totalMs = performance.now() - (authTiming?.requestStartMs ?? serviceStartMs);
      const timings = {
        requestStart: new Date().toISOString(),
        authMs: authTiming?.authMs ?? null,
        jwtMs: authTiming?.jwtMs ?? null,
        authDbLookups: authTiming?.authDbLookups ?? null,
        userLookupMs: authTiming?.userLookupMs ?? null,
        authDbError: authTiming?.authDbError ?? null,
        dbAcquireMs: timing?.dbAcquireMs ?? null,
        ensureMs: timing?.ensureMs ?? null,
        categoriesQueryMs: timing?.categoriesQueryMs ?? null,
        countQueryMs: timing?.countQueryMs ?? null,
        packsQueryMs: timing?.packsQueryMs ?? null,
        relationLoadMs: timing?.relationLoadMs ?? null,
        assignmentsQueryMs: timing?.assignmentsQueryMs ?? null,
        filterScoreMs: timing?.filterScoreMs ?? null,
        transformMs: timing?.transformMs ?? null,
        serializationMs,
        totalMs,
      };
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Server-Timing", Object.entries(timings)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
        .map(([key, value]) => `${key};dur=${value.toFixed(1)}`)
        .join(", "));
      res.setHeader("X-Readiness-Timing", Buffer.from(JSON.stringify(timings)).toString("base64url"));
      console.info({ event: "packages_list_timing", timings, count: response.items.length, total: response.pagination.total });
      return res.send(body);
    }
    const packs = await getPackageDefinitions();
    return res.json(packs);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Package search must be 160 characters or fewer." });
    }
    return next(error);
  }
});

export default router;
