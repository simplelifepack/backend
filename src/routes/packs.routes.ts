import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { getPackageDefinitions, getReadinessPacksBySlugs } from "../services/packs.service";
import { getReadinessForQuery } from "../services/readiness/readiness.service";
import { buildPackZip } from "../services/readiness/readinessZip";

const router = Router();
router.use(requireAuth);

const slugSchema = z.object({
  slug: z.string().trim().min(1),
});

const searchSchema = z.object({ q: z.string().trim().min(1).max(160) });
const idsSchema = z.object({ ids: z.string().trim().min(1).max(500) });

router.get("/search", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { q } = searchSchema.parse(req.query);
    return res.json(await getReadinessForQuery(authUser.id, q));
  } catch (error) {
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

router.get("/", async (_req, res, next) => {
  try {
    if (typeof _req.query.ids === "string") {
      const { ids } = idsSchema.parse(_req.query);
      return res.json(await getReadinessPacksBySlugs(ids.split(",")));
    }
    const packs = await getPackageDefinitions();
    return res.json(packs);
  } catch (error) {
    return next(error);
  }
});

export default router;
