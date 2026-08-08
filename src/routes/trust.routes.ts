import { Router } from "express";
import { z } from "zod";

import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import {
  acceptInvitation,
  addTrustMember,
  getTrustCenter,
  getInvitation,
  leaveTrustCenter,
  rejectInvitation,
  resetTrustInvitationPin,
  resendTrustInvitation,
  revokeTrustMember,
  updateTrustMember,
} from "../services/trustCenter.service";

const router = Router();
const idSchema = z.object({ id: z.string().trim().min(1) });
const tokenSchema = z.object({ token: z.string().trim().min(32) });

router.get("/invitations/:token", async (req, res, next) => {
  try {
    const { token } = tokenSchema.parse(req.params);
    return res.json(await getInvitation(token));
  } catch (error) {
    return next(error);
  }
});

router.post("/invitations/:token/accept", async (req, res, next) => {
  try {
    const { token } = tokenSchema.parse(req.params);
    return res.json(await acceptInvitation(token, req.body));
  } catch (error) {
    return next(error);
  }
});

router.post("/invitations/:token/reject", async (req, res, next) => {
  try {
    const { token } = tokenSchema.parse(req.params);
    return res.json(await rejectInvitation(token));
  } catch (error) {
    return next(error);
  }
});

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await getTrustCenter(authUser.id));
  } catch (error) {
    return next(error);
  }
});

router.post("/members", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.status(201).json(await addTrustMember(authUser.id, req.body));
  } catch (error) {
    return next(error);
  }
});

router.patch("/members/:id", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { id } = idSchema.parse(req.params);
    return res.json(await updateTrustMember(authUser.id, id, req.body));
  } catch (error) {
    return next(error);
  }
});

router.post("/members/:id/resend-invitation", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { id } = idSchema.parse(req.params);
    return res.json(await resendTrustInvitation(authUser.id, id));
  } catch (error) {
    return next(error);
  }
});

router.post("/members/:id/reset-pin", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { id } = idSchema.parse(req.params);
    return res.json(await resetTrustInvitationPin(authUser.id, id, req.body));
  } catch (error) {
    return next(error);
  }
});

router.delete("/members/:id", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { id } = idSchema.parse(req.params);
    await revokeTrustMember(authUser.id, id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/connections/:id/leave", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { id } = idSchema.parse(req.params);
    await leaveTrustCenter(authUser.id, id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
