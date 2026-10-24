import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "../lib/prisma";

function secret() {
  const value = process.env.WAITLIST_SECRET;
  if (!value || value.length < 32) throw new Error("WAITLIST_SECRET must contain at least 32 characters.");
  return value;
}
export function waitlistSignature(scope: string, value: string) {
  return createHmac("sha256", secret()).update(`${scope}:${value}`).digest("hex");
}
function equals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function createChallenge(ip: string, now = Date.now()) {
  const payload = `${randomUUID()}.${now + 10 * 60_000}`;
  return { token: `${payload}.${waitlistSignature("challenge", `${payload}:${ip}`)}`, difficulty: 12 };
}
export function verifyChallenge(token: string, solution: string, ip: string, now = Date.now()) {
  const [id, expiry, signature, extra] = token.split(".");
  const expiresAt = Number(expiry);
  if (extra || !id || !signature || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 10 * 60_000 || !/^\d{1,7}$/.test(solution)) return null;
  if (!equals(signature, waitlistSignature("challenge", `${id}.${expiry}:${ip}`))) return null;
  const digest = createHash("sha256").update(`${token}:${solution}`).digest();
  return digest[0] === 0 && digest[1] < 16 ? { id, expiresAt: new Date(expiresAt) } : null;
}
export function unsubscribeToken(id: string) { return `${id}.${waitlistSignature("unsubscribe", id)}`; }
export function verifyUnsubscribe(token: string) {
  const [id, signature, extra] = token.split(".");
  return !extra && id && signature && equals(signature, waitlistSignature("unsubscribe", id)) ? id : null;
}
export async function allowWaitlistRequest(scope: string, value: string, max: number) {
  const key = waitlistSignature(`limit-${scope}`, value);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "WaitlistRateLimit" ("key", "count", "expiresAt") VALUES (${key}, 1, NOW() + INTERVAL '1 hour')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "WaitlistRateLimit"."expiresAt" <= NOW() THEN 1 ELSE LEAST("WaitlistRateLimit"."count" + 1, ${max + 1}) END,
      "expiresAt" = CASE WHEN "WaitlistRateLimit"."expiresAt" <= NOW() THEN NOW() + INTERVAL '1 hour' ELSE "WaitlistRateLimit"."expiresAt" END
    RETURNING "count"`;
  return rows[0].count <= max;
}
