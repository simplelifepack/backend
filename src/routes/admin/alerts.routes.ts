import { Router } from "express";
import { z } from "zod";

import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability, requireStepUp } from "../../middleware/adminRbac";
import {
  AlertingError, createChannel, createRule, deleteChannel, deleteRule,
  listChannels, listRules, setChannelEnabled, setRuleEnabled,
} from "../../services/alerting.service";

const router = Router();
// alerts.manage has no separate "view" grant — both roles that can reach
// this at all (ops_security, owner) are step_up — so requireStepUp only
// goes on the write routes below, not here, or just opening the list would
// force a passkey prompt on every page load.
router.use(requireAdminAuth, requireCapability("alerts.manage"));

function adminCtx(req: AdminAuthenticatedRequest) {
  return { adminId: req.adminUser.id, actorEmail: req.adminUser.email };
}

function handle(error: unknown, next: (e?: unknown) => void, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (error instanceof AlertingError) return res.status(error.statusCode).json({ message: error.message });
  return next(error);
}

router.get("/channels", async (_req, res, next) => {
  try {
    return res.json({ channels: await listChannels() });
  } catch (error) {
    return next(error);
  }
});

const createChannelSchema = z.object({
  type: z.enum(["email", "webhook"]), name: z.string().trim().min(1).max(100), target: z.string().trim().min(1).max(500),
});

router.post("/channels", requireStepUp, async (req, res, next) => {
  try {
    const input = createChannelSchema.parse(req.body);
    const channel = await createChannel(adminCtx(req as unknown as AdminAuthenticatedRequest), input);
    return res.json({ channel });
  } catch (error) {
    return handle(error, next, res);
  }
});

router.post("/channels/:id/enable", requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const channel = await setChannelEnabled(adminCtx(req as unknown as AdminAuthenticatedRequest), id, true);
    return res.json({ channel });
  } catch (error) {
    return handle(error, next, res);
  }
});

router.post("/channels/:id/disable", requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const channel = await setChannelEnabled(adminCtx(req as unknown as AdminAuthenticatedRequest), id, false);
    return res.json({ channel });
  } catch (error) {
    return handle(error, next, res);
  }
});

router.delete("/channels/:id", requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    await deleteChannel(adminCtx(req as unknown as AdminAuthenticatedRequest), id);
    return res.json({ ok: true });
  } catch (error) {
    return handle(error, next, res);
  }
});

router.get("/rules", async (_req, res, next) => {
  try {
    return res.json({ rules: await listRules() });
  } catch (error) {
    return next(error);
  }
});

const createRuleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sourceModule: z.string().trim().min(1).max(40),
  condition: z.literal("job_failed"),
  jobType: z.enum(["key_rewrap", "storage_audit", "package_source_backfill"]).nullable().optional(),
  channelId: z.string().min(1),
  cooldownMinutes: z.coerce.number().int().min(1).max(10_080).optional(), // max 1 week
});

router.post("/rules", requireStepUp, async (req, res, next) => {
  try {
    const input = createRuleSchema.parse(req.body);
    const rule = await createRule(adminCtx(req as unknown as AdminAuthenticatedRequest), input);
    return res.json({ rule });
  } catch (error) {
    return handle(error, next, res);
  }
});

router.post("/rules/:id/enable", requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const rule = await setRuleEnabled(adminCtx(req as unknown as AdminAuthenticatedRequest), id, true);
    return res.json({ rule });
  } catch (error) {
    return handle(error, next, res);
  }
});

router.post("/rules/:id/disable", requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const rule = await setRuleEnabled(adminCtx(req as unknown as AdminAuthenticatedRequest), id, false);
    return res.json({ rule });
  } catch (error) {
    return handle(error, next, res);
  }
});

router.delete("/rules/:id", requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    await deleteRule(adminCtx(req as unknown as AdminAuthenticatedRequest), id);
    return res.json({ ok: true });
  } catch (error) {
    return handle(error, next, res);
  }
});

export default router;
