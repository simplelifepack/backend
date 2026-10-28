import { Agent } from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { publicSourceAddress } from "../ai/packageSourcePage";
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

export function validateSubscription(input: unknown): BrowserPushSubscription {
  const candidate = input as Partial<BrowserPushSubscription> | null;
  const endpoint = typeof candidate?.endpoint === "string" ? candidate.endpoint.trim() : "";
  const p256dh = typeof candidate?.keys?.p256dh === "string" ? candidate.keys.p256dh.trim() : "";
  const auth = typeof candidate?.keys?.auth === "string" ? candidate.keys.auth.trim() : "";
  if (!endpoint || !p256dh || !auth) throw httpError("Push subscription is incomplete.", 400);
  let url: URL;
  try { url = new URL(endpoint); } catch { throw httpError("Push subscription endpoint is invalid.", 400); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || hostname === "localhost" || (isIP(hostname) && !publicSourceAddress(hostname))) throw httpError("Push subscription endpoint is invalid.", 400);
  return { endpoint, keys: { p256dh, auth } };
}

function toWebPush(subscription: BrowserPushSubscription): WebPushSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
  };
}

export function safeInternalUrl(url: string | undefined) {
  if (!url?.startsWith("/")) return "/";
  try {
    const parsed = new URL(url, "https://readines.invalid");
    return parsed.origin === "https://readines.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/";
  } catch { return "/"; }
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

// Validate DNS on the actual connection to prevent rebinding to internal services.
const pushAgent = new Agent({
  lookup(hostname, _options, callback) {
    lookup(hostname, { family: 4, all: true }, (error, addresses) => {
      if (error) return callback(error, "", 4);
      if (!addresses.length || addresses.some(item => !publicSourceAddress(item.address))) return callback(new Error("Private push endpoint rejected."), "", 4);
      callback(null, addresses[0]!.address, 4);
    });
  },
});

async function deactivateExpired(id: string) {
  await prisma.pushSubscription.update({
    where: { id },
    data: { active: false, revokedAt: new Date() },
  }).catch(() => undefined);
}

export async function sendPushToUser(userId: string, payload: NotificationPayload) {
  if (!configureWebPush()) throw httpError("Push notifications are not configured on this server.", 503, "PUSH_NOT_CONFIGURED");
  const safePayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: safeInternalUrl(payload.url),
  });
  let attempted = 0, sent = 0;
  let cursor: string | undefined;
  while (true) {
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId, active: true, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 100 });
    if (!subscriptions.length) break;
    for (let index = 0; index < subscriptions.length; index += 5) {
    await Promise.all(subscriptions.slice(index, index + 5).map(async subscription => {
    attempted += 1;
    try {
      const checked = validateSubscription({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } });
      await webPush.sendNotification(toWebPush({
        endpoint: checked.endpoint,
        keys: checked.keys,
      }), safePayload, { agent: pushAgent, timeout: 10_000 });
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) await deactivateExpired(subscription.id);

    }
    }));
    }
    cursor = subscriptions[subscriptions.length - 1].id;
  }
  return {
    attempted,
    sent,
  };
}

