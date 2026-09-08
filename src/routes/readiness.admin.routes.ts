import { Router } from "express";

import { adminLimiter, requireAdminSeedToken } from "../middleware/security";
import { seedReadinessPacks } from "../services/readiness/readiness.service";

export const adminReadinessRouter = Router();

adminReadinessRouter.post("/seed", adminLimiter, requireAdminSeedToken, async (_req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_READINESS_SEED !== "true") {
      return res.status(403).json({ message: "Readiness seed is disabled in production." });
    }
    const result = await seedReadinessPacks();
    return res.json({ seeded: result.count });
  } catch (error) {
    return next(error);
  }
});
