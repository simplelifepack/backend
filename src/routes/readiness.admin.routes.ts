import { Router } from "express";

import { adminLimiter, requireAdminSeedToken } from "../middleware/security";

export const adminReadinessRouter = Router();

adminReadinessRouter.post("/seed", adminLimiter, requireAdminSeedToken, async (_req, res, next) => {
  try {
    return res.status(410).json({ message: "Readiness package defaults are managed by database migrations." });
  } catch (error) {
    return next(error);
  }
});
