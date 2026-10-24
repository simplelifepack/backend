import { Router } from "express";
import { z } from "zod";

import { requireAdminAuth } from "../../middleware/adminAuth";
import { requireCapability } from "../../middleware/adminRbac";
import { getBillingStats, listTierChangeHistory } from "../../services/adminBilling.service";

const router = Router();
router.use(requireAdminAuth, requireCapability("billing.view"));

router.get("/stats", async (_req, res, next) => {
  try {
    return res.json(await getBillingStats());
  } catch (error) {
    return next(error);
  }
});

const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).catch(50) });

router.get("/tier-changes", async (req, res, next) => {
  try {
    const { limit } = limitSchema.parse(req.query);
    return res.json({ items: await listTierChangeHistory(limit) });
  } catch (error) {
    return next(error);
  }
});

export default router;
