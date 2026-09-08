import { packageInputSchema } from "../ai/packageInput";
import { buildErrorResponse } from "../middleware/errorHandling";
import type { ProviderRequestOptions } from "../ai/providers/types";
import { Router } from "express";
import { z } from "zod";
import { AIUnavailableError, PackageGenerationRejectedError, analyzeIntent } from "../ai/analyzeIntent";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { getPackageDefinitions, getReadinessPackDefinitionBySlug, getReadinessPacksBySlugs, listPackageSummaries } from "../services/packs.service";
import { findDefaultPackMatch, saveGeneratedDefaultPack } from "../services/readiness/defaultPacksRepository";

const router = Router();
router.use(requireAuth);

const slugSchema = z.object({
  slug: z.string().trim().min(1),
});

const searchSchema = z.object({ q: z.string().trim().min(1).max(160) });
const idsSchema = z.object({ ids: z.string().trim().min(1).max(500) });
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

router.get("/:slug", async (req, res, next) => {
  try {
    const { slug } = slugSchema.parse(req.params);
    const pack = await getReadinessPackDefinitionBySlug(slug);
    if (!pack) {
      return res.status(404).json({ message: "Pack not found." });
    }
    return res.json(pack);
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
      return res.json(await listPackageSummaries({ ...options, userId: authUser.id }));
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
