import { Router } from "express";
import { z } from "zod";

import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { searchReadinessData } from "../services/globalSearch.service";

const router = Router();
router.use(requireAuth);

const searchSchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).optional(),
  q: z.string().trim().min(1).max(160),
});

router.get("/", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { q, limit } = searchSchema.parse(req.query);
    return res.json(await searchReadinessData(authUser.id, q, limit));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Search query must be 160 characters or fewer." });
    }
    return next(error);
  }
});

export default router;
