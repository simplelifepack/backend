import { Router } from "express";
import { z } from "zod";

import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability, requireStepUp } from "../../middleware/adminRbac";
import {
  AdminAIError, getTaskConfigDetail, listTaskConfigs, publishTaskConfig, testTaskConfig, upsertBudget,
} from "../../services/adminAI.service";

const router = Router();
// The access matrix (#access) gives this capability one row — "Publish a
// prompt/model change": ops_security/owner only (support and catalogue get
// none, not even view) — so the whole AI operations surface, reads
// included, is gated by this one capability. Step-up is added per-route
// below only for the actual write/spend actions, same as every other
// screen this session — reading the current config needs no fresh passkey.
router.use(requireAdminAuth, requireCapability("ai.prompt.publish"));

function adminCtx(req: AdminAuthenticatedRequest) {
  return { adminId: req.adminUser.id, actorEmail: req.adminUser.email };
}

function handleError(error: unknown, next: (e?: unknown) => void, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (error instanceof AdminAIError) return res.status(error.statusCode).json({ message: error.message });
  return next(error);
}

router.get("/tasks", async (_req, res, next) => {
  try {
    return res.json({ tasks: await listTaskConfigs() });
  } catch (error) {
    return next(error);
  }
});

router.get("/tasks/:taskKey", async (req, res, next) => {
  try {
    const taskKey = z.string().min(1).parse(req.params.taskKey);
    return res.json(await getTaskConfigDetail(taskKey));
  } catch (error) {
    return handleError(error, next, res);
  }
});

const promptConfigSchema = z.union([
  z.object({ kind: z.literal("string"), text: z.string().min(1) }),
  z.object({ kind: z.literal("array"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("multi"), parts: z.record(z.string(), z.string().min(1)) }),
]);

const publishSchema = z.object({
  primaryModel: z.string().trim().min(1),
  fallbackModel: z.string().trim().min(1).nullable().optional(),
  promptConfig: promptConfigSchema,
  testResult: z.unknown().optional(),
  reason: z.string().trim().min(3).max(500),
});

router.post("/tasks/:taskKey/publish", requireStepUp, async (req, res, next) => {
  try {
    const taskKey = z.string().min(1).parse(req.params.taskKey);
    const { reason, ...input } = publishSchema.parse(req.body);
    const config = await publishTaskConfig(adminCtx(req as unknown as AdminAuthenticatedRequest), taskKey, input, reason);
    return res.json({ config });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const testSchema = z.object({
  primaryModel: z.string().trim().min(1),
  promptConfig: promptConfigSchema,
});

router.post("/tasks/:taskKey/test", requireStepUp, async (req, res, next) => {
  try {
    const taskKey = z.string().min(1).parse(req.params.taskKey);
    const draft = testSchema.parse(req.body);
    return res.json(await testTaskConfig(taskKey, draft));
  } catch (error) {
    return handleError(error, next, res);
  }
});

const budgetSchema = z.object({ monthlyCapUsd: z.number().positive().max(100_000), reason: z.string().trim().min(3).max(500) });

router.post("/tasks/:taskKey/budget", requireStepUp, async (req, res, next) => {
  try {
    const taskKey = z.string().min(1).parse(req.params.taskKey);
    const { monthlyCapUsd, reason } = budgetSchema.parse(req.body);
    const budget = await upsertBudget(adminCtx(req as unknown as AdminAuthenticatedRequest), taskKey, monthlyCapUsd, reason);
    return res.json({ budget });
  } catch (error) {
    return handleError(error, next, res);
  }
});

export default router;
