import { Router } from "express";

import { requireAdminAuth } from "../../middleware/adminAuth";
import { requireCapability } from "../../middleware/adminRbac";
import { getTrustStats } from "../../services/adminTrust.service";

const router = Router();
router.use(requireAdminAuth, requireCapability("trust.view"));

router.get("/stats", async (_req, res, next) => {
  try {
    return res.json(await getTrustStats());
  } catch (error) {
    return next(error);
  }
});

export default router;
