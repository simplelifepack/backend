import { Router } from "express";
import { z } from "zod";

import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability, requireStepUp } from "../../middleware/adminRbac";
import {
  ADMIN_ROLES, AdminAdminsError, changeAdminRole, getAccessReviewStatus, getAdminDetail, inviteAdmin,
  listAdmins, recordAccessReview, revokeAdminSession, setAdminDisabled,
} from "../../services/adminAdmins.service";

const router = Router();
// The access matrix (#access) gives this one row — "Manage admins and roles":
// owner-only, approval. There's no separate "view" grant for it (unlike
// users.view), so reading the roster is gated the same as managing it.
router.use(requireAdminAuth, requireCapability("admins.manage"));

function adminCtx(req: AdminAuthenticatedRequest) {
  return { adminId: req.adminUser.id, actorEmail: req.adminUser.email };
}

function handleError(error: unknown, next: (e?: unknown) => void, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (error instanceof AdminAdminsError) return res.status(error.statusCode).json({ message: error.message });
  return next(error);
}

router.get("/", async (_req, res, next) => {
  try {
    return res.json({ admins: await listAdmins() });
  } catch (error) {
    return next(error);
  }
});

const roleEnum = z.enum(ADMIN_ROLES as [string, ...string[]]);
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

// Ahead of /:id — "access-review" would otherwise be swallowed as an :id param.
router.get("/access-review", async (_req, res, next) => {
  try {
    return res.json(await getAccessReviewStatus());
  } catch (error) {
    return next(error);
  }
});

router.post("/access-review", requireStepUp, async (req, res, next) => {
  try {
    const { reason } = reasonSchema.parse(req.body);
    const status = await recordAccessReview(adminCtx(req as unknown as AdminAuthenticatedRequest), reason);
    return res.json(status);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    return res.json({ admin: await getAdminDetail(id) });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const inviteSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(160),
  role: roleEnum,
  reason: z.string().trim().min(3).max(500),
});

router.post("/", requireStepUp, async (req, res, next) => {
  try {
    const { reason, ...input } = inviteSchema.parse(req.body);
    const admin = await inviteAdmin(adminCtx(req as unknown as AdminAuthenticatedRequest), input as { email: string; name: string; role: typeof ADMIN_ROLES[number] }, reason);
    return res.status(201).json({ admin });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const roleChangeSchema = z.object({ role: roleEnum, reason: z.string().trim().min(3).max(500) });

router.post("/:id/role", requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { role, reason } = roleChangeSchema.parse(req.body);
    const admin = await changeAdminRole(adminCtx(req as unknown as AdminAuthenticatedRequest), id, role as typeof ADMIN_ROLES[number], reason);
    return res.json({ admin });
  } catch (error) {
    return handleError(error, next, res);
  }
});

router.post("/:id/disable", requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { reason } = reasonSchema.parse(req.body);
    const admin = await setAdminDisabled(adminCtx(req as unknown as AdminAuthenticatedRequest), id, true, reason);
    return res.json({ admin });
  } catch (error) {
    return handleError(error, next, res);
  }
});

router.post("/:id/enable", requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { reason } = reasonSchema.parse(req.body);
    const admin = await setAdminDisabled(adminCtx(req as unknown as AdminAuthenticatedRequest), id, false, reason);
    return res.json({ admin });
  } catch (error) {
    return handleError(error, next, res);
  }
});

const sessionReasonSchema = z.object({ reason: z.string().trim().min(3).max(500).optional() });

router.post("/:id/sessions/:sessionId/revoke", requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const sessionId = z.string().min(1).parse(req.params.sessionId);
    const { reason } = sessionReasonSchema.parse(req.body);
    const session = await revokeAdminSession(adminCtx(req as unknown as AdminAuthenticatedRequest), id, sessionId, reason);
    return res.json({ session });
  } catch (error) {
    return handleError(error, next, res);
  }
});

export default router;
