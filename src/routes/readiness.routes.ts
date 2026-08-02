import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { adminLimiter, requireAdminSeedToken } from "../middleware/security";
import {
  getReadinessForQuery,
  getReadinessForSlug,
  searchReadinessPacks,
  seedReadinessPacks,
} from "../services/readiness/readiness.service";

const router = Router();
router.use(requireAuth);

const querySchema = z.object({
  q: z.string().trim().min(1),
});

const slugSchema = z.object({
  slug: z.string().trim().min(1),
});

router.get("/search", async (req, res, next) => {
  try {
    const { q } = querySchema.parse(req.query);
    const packs = await searchReadinessPacks(q);
    return res.json(packs);
  } catch (error) {
    return next(error);
  }
});

router.get("/check", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { q } = querySchema.parse(req.query);
    const result = await getReadinessForQuery(authUser.id, q);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { slug } = slugSchema.parse(req.params);
    const result = await getReadinessForSlug(authUser.id, slug);

    if (!result.matchedPack) {
      return res.status(404).json({
        message: "Readiness pack not found.",
        suggestions: result.suggestions,
      });
    }

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export const adminReadinessRouter = Router();

adminReadinessRouter.post("/seed", adminLimiter, requireAdminSeedToken, async (_req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_READINESS_SEED !== "true") {
      return res.status(403).json({ message: "Readiness seed is disabled in production." });
    }

    const result = await seedReadinessPacks();
    return res.json({
      seeded: result.count,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
