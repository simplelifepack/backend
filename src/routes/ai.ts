import { Router } from "express";
import { z } from "zod";
import { AIUnavailableError, PackageGenerationRejectedError, analyzeIntent } from "../ai/analyzeIntent";
import { requireAuth } from "../middleware/requireAuth";
import type { AuthenticatedRequest } from "../middleware/requireAuth";
import { getReadinessForSlug } from "../services/readiness/readiness.service";
import { findDefaultPackSlug, saveGeneratedDefaultPack } from "../services/readiness/defaultPacksRepository";

const router = Router();
const requestSchema = z.object({
  query: z.string().trim().min(1).max(500),
}).strict();

router.use(requireAuth);

router.post("/analyzeIntent", async (req, res, next) => {
  try {
    const { query } = requestSchema.parse(req.body);
    const { authUser } = req as AuthenticatedRequest;
    const existingSlug = await findDefaultPackSlug(query);
    if (existingSlug) {
      console.info(`[LifePack AI]\nDefault Pack: found\nPackage: ${existingSlug}\nAI Called: false`);
      return res.json(await getReadinessForSlug(authUser.id, existingSlug));
    }
    console.info("[LifePack AI]\nDefault Pack: not found\nAI Called: true");
    const generatedPackage = await analyzeIntent(query);
    const slug = await saveGeneratedDefaultPack(query, generatedPackage);
    return res.json(await getReadinessForSlug(authUser.id, slug));
  } catch (error) {
    if (error instanceof AIUnavailableError || error instanceof PackageGenerationRejectedError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

export default router;
