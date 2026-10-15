import { Router } from "express";
import { z } from "zod";

import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability } from "../../middleware/adminRbac";
import {
  AdminFeedbackError, FEEDBACK_STATUSES, assignFeedback, getFeedbackDetail, listFeedback, updateFeedbackStatus,
} from "../../services/adminFeedback.service";

const router = Router();
// The access matrix (#access) already names this capability — "Resolve or
// assign a feedback ticket": support yes, catalogue none, ops_security none,
// owner yes. Gates viewing the queue too; there's no separate view grant in
// the matrix for this row, and support/owner both having "yes" (not
// step_up) means viewing was already implicitly unrestricted for them.
router.use(requireAdminAuth, requireCapability("feedback.resolve"));

function adminCtx(req: AdminAuthenticatedRequest) {
  return { adminId: req.adminUser.id, actorEmail: req.adminUser.email };
}

function handleError(error: unknown, next: (e?: unknown) => void, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (error instanceof AdminFeedbackError) return res.status(error.statusCode).json({ message: error.message });
  return next(error);
}

const statusEnum = z.enum(FEEDBACK_STATUSES);
const listSchema = z.object({
  status: statusEnum.optional(),
  category: z.enum(["bug", "idea", "other"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).catch(50),
});

router.get("/", async (req, res, next) => {
  try {
    const { status, category, limit } = listSchema.parse(req.query);
    return res.json(await listFeedback({ status, category, limit }));
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    return res.json({ item: await getFeedbackDetail(id) });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const statusUpdateSchema = z.object({ status: statusEnum, note: z.string().trim().max(1000).optional() });

router.post("/:id/status", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { status, note } = statusUpdateSchema.parse(req.body);
    const item = await updateFeedbackStatus(adminCtx(req as unknown as AdminAuthenticatedRequest), id, status, note);
    return res.json({ item });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const assignSchema = z.object({ adminId: z.string().trim().min(1).nullable() });

router.post("/:id/assign", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { adminId } = assignSchema.parse(req.body);
    const item = await assignFeedback(adminCtx(req as unknown as AdminAuthenticatedRequest), id, adminId);
    return res.json({ item });
  } catch (error) {
    return handleError(error, next, res);
  }
});

export default router;
