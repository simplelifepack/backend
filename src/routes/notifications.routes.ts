import { Router } from "express";

import { adminLimiter, requireAdminSeedToken } from "../middleware/security";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";
import {
  disablePushSubscription,
  getPushConfig,
  getPushStatus,
  registerPushSubscription,
  sendPushToUser,
} from "../services/pushNotifications.service";

const router = Router();
router.use(requireAuth);
export const adminNotificationsRouter = Router();

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function adminPayload(body: unknown) {
  const record = body as Record<string, unknown> | null;
  const userId = text(record?.userId);
  const email = text(record?.email).toLowerCase();
  const title = text(record?.title, "Readiness").slice(0, 80) || "Readiness";
  const message = text(record?.body, "Open Readiness for details.").slice(0, 160) || "Open Readiness for details.";
  const rawUrl = text(record?.url, "/").slice(0, 240);
  const url = rawUrl.startsWith("/") && !rawUrl.startsWith("//") ? rawUrl : "/";
  if (!userId && !email) throw Object.assign(new Error("userId or email is required."), { statusCode: 400 });
  return { userId, email, title, body: message, url };
}

router.get("/config", (_req, res) => {
  res.json(getPushConfig());
});

router.post("/status", async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : undefined;
    res.json(await getPushStatus(authUser.id, endpoint));
  } catch (error) {
    next(error);
  }
});

router.post("/subscriptions", async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    res.json(await registerPushSubscription(authUser.id, req.body?.subscription, req.get("user-agent")));
  } catch (error) {
    next(error);
  }
});

router.post("/subscriptions/disable", async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    res.json(await disablePushSubscription(authUser.id, req.body?.subscription));
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    res.json(await sendPushToUser(authUser.id, {
      title: "Readiness notification test",
      body: "Notifications are working on this device.",
      url: "/settings",
    }));
  } catch (error) {
    next(error);
  }
});

adminNotificationsRouter.post("/send", adminLimiter, requireAdminSeedToken, async (req, res, next) => {
  try {
    const payload = adminPayload(req.body);
    const user = await prisma.user.findFirst({
      where: payload.userId ? { id: payload.userId } : { email: payload.email },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ message: "User not found." });
    const result = await sendPushToUser(user.id, {
      title: payload.title,
      body: payload.body,
      url: payload.url,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
