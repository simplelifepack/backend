import { Router } from "express";
import { z } from "zod";
import { AIUnavailableError, PackageGenerationRejectedError, analyzeIntent } from "../ai/analyzeIntent";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { getPackageDefinitions, getReadinessPackDefinitionBySlug, getReadinessPacksBySlugs, listPackageSummaries } from "../services/packs.service";
import { getReadinessForQuery, getReadinessForSlug } from "../services/readiness/readiness.service";
import { findDefaultPackMatch, saveGeneratedDefaultPack } from "../services/readiness/defaultPacksRepository";
import { buildPackZip } from "../services/readiness/readinessZip";
import { assertAndIncrementUnknownPackSearch } from "../services/entitlements.service";

const router = Router();
router.use(requireAuth);

const slugSchema = z.object({
  slug: z.string().trim().min(1),
});

const searchSchema = z.object({ q: z.string().trim().min(1).max(160) });
const idsSchema = z.object({ ids: z.string().trim().min(1).max(500) });
const listSchema = z.object({
  category: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).catch(20),
  location: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).catch(1),
  provider: z.string().trim().min(1).max(80).optional(),
  search: z.string().trim().min(1).max(160).optional(),
  sort: z.enum(["category", "newest", "relevance", "title"]).catch("category"),
});
const searchOrGenerateSchema = z.object({
  query: z.string().trim().min(1).max(500),
}).strict();

router.get("/search", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { q } = searchSchema.parse(req.query);
    return res.json(await getReadinessForQuery(authUser.id, q));
  } catch (error) {
    return next(error);
  }
});

router.post("/search-or-generate", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { query } = searchOrGenerateSchema.parse(req.body);
    const existing = await findDefaultPackMatch(query);
    const shouldGenerate = !existing;
    const source = shouldGenerate ? "official_source" : "existing";
    if (shouldGenerate) await assertAndIncrementUnknownPackSearch(authUser.id);
    const slug = shouldGenerate
      ? await saveGeneratedDefaultPack(query, await analyzeIntent(query))
      : existing.slug;
    const [packageDefinition, readiness] = await Promise.all([
      getReadinessPackDefinitionBySlug(slug),
      getReadinessForSlug(authUser.id, slug),
    ]);

    if (!packageDefinition) {
      return res.status(404).json({ message: "Package could not be loaded." });
    }

    console.info(`[LifePack Package Search]\nQuery: ${query}\nPackage: ${slug}\nSource: ${source}\nAI Called: ${shouldGenerate}`);
    return res.json({
      source,
      confidence: existing?.confidence ?? null,
      matchReason: existing?.reason ?? null,
      package: packageDefinition,
      readiness,
    });
  } catch (error) {
    if (error instanceof AIUnavailableError || error instanceof PackageGenerationRejectedError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.get("/:slug/download", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { slug } = slugSchema.parse(req.params);
    const bundle = await buildPackZip(authUser.id, slug);

    if (!bundle) {
      return res.status(404).json({ message: "Pack not found." });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${bundle.fileName}"`);
    res.setHeader("Content-Length", bundle.zip.length);
    return res.send(bundle.zip);
  } catch (error) {
    return next(error);
  }
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
    return next(error);
  }
});

export default router;
