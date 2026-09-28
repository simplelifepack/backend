import webPush, { type PushSubscription as WebPushSubscription } from "web-push";

import { prisma } from "../lib/prisma";

type BrowserPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type NotificationPayload = {
  title: string;
  body: string;
  url?: string;
};

let configured = false;

function config() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:support@readiness.com";
  return { publicKey, privateKey, subject, enabled: Boolean(publicKey && privateKey) };
}

function configureWebPush() {
  const vapid = config();
  if (!vapid.enabled) return false;
  if (!configured) {
    webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    configured = true;
  }
  return true;
}

function httpError(message: string, statusCode: number, code?: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

function validateSubscription(input: unknown): BrowserPushSubscription {
  const candidate = input as Partial<BrowserPushSubscription> | null;
  const endpoint = typeof candidate?.endpoint === "string" ? candidate.endpoint.trim() : "";
  const p256dh = typeof candidate?.keys?.p256dh === "string" ? candidate.keys.p256dh.trim() : "";
  const auth = typeof candidate?.keys?.auth === "string" ? candidate.keys.auth.trim() : "";
  if (!endpoint || !p256dh || !auth) throw httpError("Push subscription is incomplete.", 400);
  if (!endpoint.startsWith("https://")) throw httpError("Push subscription endpoint is invalid.", 400);
  return { endpoint, keys: { p256dh, auth } };
}

function toWebPush(subscription: BrowserPushSubscription): WebPushSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
  };
}

function safeInternalUrl(url: string | undefined) {
  if (!url?.startsWith("/")) return "/";
  if (url.startsWith("//")) return "/";
  return url;
}

export function getPushConfig() {
  const vapid = config();
  return {
    configured: vapid.enabled,
    publicKey: vapid.publicKey || null,
  };
}

export async function getPushStatus(userId: string, endpoint?: string) {
  const vapid = config();
  const subscription = endpoint
    ? await prisma.pushSubscription.findFirst({ where: { userId, endpoint } })
    : null;
  return {
    configured: vapid.enabled,
    publicKey: vapid.publicKey || null,
    deviceEnabled: Boolean(subscription?.active),
  };
}

export async function registerPushSubscription(userId: string, input: unknown, userAgent?: string) {
  const subscription = validateSubscription(input);
  if (!configureWebPush()) throw httpError("Push notifications are not configured on this server.", 503, "PUSH_NOT_CONFIGURED");
  const saved = await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
      active: true,
    },
    update: {
      userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
      active: true,
      revokedAt: null,
    },
  });
  return { deviceEnabled: saved.active };
}

export async function disablePushSubscription(userId: string, input: unknown) {
  const subscription = validateSubscription(input);
  await prisma.pushSubscription.updateMany({
    where: { userId, endpoint: subscription.endpoint },
    data: { active: false, revokedAt: new Date() },
  });
  return { deviceEnabled: false };
}

async function deactivateExpired(id: string) {
  await prisma.pushSubscription.update({
    where: { id },
    data: { active: false, revokedAt: new Date() },
  }).catch(() => undefined);
}

export async function sendPushToUser(userId: string, payload: NotificationPayload) {
  if (!configureWebPush()) throw httpError("Push notifications are not configured on this server.", 503, "PUSH_NOT_CONFIGURED");
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId, active: true } });
  const safePayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: safeInternalUrl(payload.url),
  });
  const results = await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webPush.sendNotification(toWebPush({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }), safePayload);
      return { id: subscription.id, sent: true };
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) await deactivateExpired(subscription.id);
      return { id: subscription.id, sent: false, statusCode };
    }
  }));
  return {
    attempted: results.length,
    sent: results.filter((result) => result.sent).length,
  };
}

