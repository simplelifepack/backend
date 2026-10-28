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
import { searchOrGenerateSchema, generateAndSavePackage, assignmentParamsSchema, assignmentSchema, idsSchema, listSchema } from "./packs.routes";

import type { RequestHandler } from "express";
export const generatePackageHandler: RequestHandler = async (req, res, next) => {
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
};
export const assignPackageDocumentHandler: RequestHandler = async (req, res, next) => {
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
};
export const listPackagesHandler: RequestHandler = async (_req, res, next) => {
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
};
