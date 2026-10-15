import { Router } from "express";
import { z } from "zod";

import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability, requireStepUp } from "../../middleware/adminRbac";
import {
  AdminIntegrationsError, forceDisconnect, listDisconnectedConnections, listScanErrors, listStuckScans,
} from "../../services/adminIntegrations.service";

const router = Router();
router.use(requireAdminAuth, requireCapability("integrations.view"));

const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).catch(50) });

router.get("/disconnected", async (req, res, next) => {
  try {
    const { limit } = limitSchema.parse(req.query);
    return res.json(await listDisconnectedConnections(limit));
  } catch (error) {
    return next(error);
  }
});

router.get("/scan-errors", async (req, res, next) => {
  try {
    const { limit } = limitSchema.parse(req.query);
    return res.json(await listScanErrors(limit));
  } catch (error) {
    return next(error);
  }
});

router.get("/stuck-scans", async (req, res, next) => {
  try {
    const { limit } = limitSchema.parse(req.query);
    return res.json(await listStuckScans(limit));
  } catch (error) {
    return next(error);
  }
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

router.post("/:id/disconnect", requireCapability("integrations.disconnect"), requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { reason } = reasonSchema.parse(req.body);
    const { adminUser } = req as AdminAuthenticatedRequest;
    const result = await forceDisconnect({ adminId: adminUser.id, actorEmail: adminUser.email }, id, reason);
    return res.json(result);
  } catch (error) {
    if (error instanceof AdminIntegrationsError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

export default router;
