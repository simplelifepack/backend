import { decryptPrivateValue } from "../privacy/fieldEncryption";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { after, beforeEach, test } from "node:test";
import express from "express";
import cors from "cors";
import { prisma } from "../lib/prisma";
import router from "./waitlist.routes";
import { corsOptions } from "../middleware/security";
import { allowedBrowserOrigins, productionDomainAccess } from "../middleware/domainAccess";
import { setEmailProviderForTests, sendWaitlistEmail } from "../services/email/emailService";
import type { SendEmailInput } from "../services/email/EmailProvider";
import { deliverWaitlistConfirmation } from "../services/waitlist";
import { allowWaitlistRequest, createChallenge, verifyChallenge } from "../services/waitlistSecurity";

if (!process.env.DATABASE_URL?.includes("127.0.0.1:55439/waitlist_test")) throw new Error("Use the disposable waitlist_test database on 127.0.0.1:55439 only.");
process.env.WAITLIST_SECRET = "local-integration-test-secret-32-characters";
process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "waitlist-test";
process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ "waitlist-test": `base64:${randomBytes(32).toString("base64")}` });
process.env.PRIVATE_DATA_LOOKUP_KEY = `base64:${randomBytes(32).toString("base64")}`;
const sent: SendEmailInput[] = [];
const app = express();
app.use(cors(corsOptions), productionDomainAccess, express.json());
app.use("/api/waitlist", router);
app.get("/api/protected", (_req, res) => res.status(401).json({ message: "Authentication required" }));
app.post("/auth/login", (_req, res) => res.status(401).json({ message: "Authentication required" }));
const server = app.listen(0, "127.0.0.1");
after(async () => { server.close(); await prisma.$disconnect(); });
async function base() { if (!server.listening) await once(server, "listening"); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
async function call(path: string, body?: unknown, origin = "https://readines.com") {
  return fetch(`${await base()}${path}`, { method: body ? "POST" : "GET", headers: { Origin: origin, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}
function solve(token: string) {
  for (let n = 0; ; n++) { const hash = createHash("sha256").update(`${token}:${n}`).digest(); if (hash[0] === 0 && hash[1] < 16) return String(n); }
}
async function submission(email: string) {
  const { token } = await (await call("/api/waitlist/challenge")).json() as { token: string };
  return { email, website: "", challenge: token, solution: solve(token) };
}
beforeEach(async () => {
  await prisma.waitlistRegistration.deleteMany();
  await prisma.waitlistProof.deleteMany();
  await prisma.waitlistRateLimit.deleteMany();
  sent.length = 0;
  setEmailProviderForTests({ sendEmail: async input => { sent.push(input); return { messageId: "local-smtp-accepted" }; } });
});
test("registers normalized email, records delivery, duplicates and concurrent submits send once", async () => {
  const bodies = await Promise.all(Array.from({ length: 4 }, () => submission(" Person@Example.com ")));
  const responses = await Promise.all(bodies.map(body => call("/api/waitlist/register", body)));
  assert.deepEqual(responses.map(response => response.status), [200, 200, 200, 200]);
  assert.equal(await prisma.waitlistRegistration.count(), 1);
  assert.equal(sent.length, 1);
  const row = await prisma.waitlistRegistration.findFirstOrThrow();
  assert.notEqual(row.email, "person@example.com");
  assert.equal(decryptPrivateValue<string>(row.private_email, { model: "WaitlistRegistration", recordId: row.id, ownerId: row.id, field: "email" }), "person@example.com");
  assert(!row.private_email.includes("person@example.com")); assert.equal(row.status, "registered");
  assert.equal(row.confirmationStatus, "sent"); assert.equal(row.confirmationAttempts, 1);
  assert.equal(row.confirmationMessageId, "local-smtp-accepted"); assert.ok(row.confirmationSentAt); assert.ok(row.registeredAt);
  assert.equal((await call("/api/waitlist/register", await submission("person@example.com"))).status, 200);
  assert.equal(sent.length, 1);
});
test("rejects invalid email, invalid proof, expired or replayed challenges; honeypot stores nothing", async () => {
  const body = await submission("valid@example.com");
  assert.equal((await call("/api/waitlist/register", { ...body, email: "invalid" })).status, 400);
  assert.equal((await call("/api/waitlist/register", { ...body, challenge: "forged" })).status, 400);
  assert.equal((await call("/api/waitlist/register", { ...body, website: "bot" })).status, 200);
  assert.equal(await prisma.waitlistRegistration.count(), 0);
  assert.equal((await call("/api/waitlist/register", body)).status, 200);
  assert.equal((await call("/api/waitlist/register", body)).status, 400);
  const expired = createChallenge("127.0.0.1", Date.now() - 11 * 60_000);
  assert.equal(verifyChallenge(expired.token, solve(expired.token), "127.0.0.1"), null);
  const challenge = createChallenge("127.0.0.1");
  assert.equal(verifyChallenge(challenge.token, solve(challenge.token), "different-ip"), null);
});
test("unsubscribes idempotently only after explicit POST and never resends on re-registration", async () => {
  await call("/api/waitlist/register", await submission("consent@example.com"));
  const link = sent[0].text.match(/Unsubscribe: (\S+)/)![1];
  const token = new URL(link).searchParams.get("waitlistUnsubscribe")!;
  assert.equal((await call(`/api/waitlist/unsubscribe?token=${encodeURIComponent(token)}`)).status, 403);
  assert.equal((await prisma.waitlistRegistration.findFirstOrThrow()).status, "registered");
  assert.equal((await call("/api/waitlist/unsubscribe", { token: `${token}bad` })).status, 400);
  for (let n = 0; n < 2; n++) assert.equal((await call("/api/waitlist/unsubscribe", { token })).status, 200);
  await call("/api/waitlist/register", await submission("consent@example.com"));
  const row = await prisma.waitlistRegistration.findFirstOrThrow();
  assert.equal(row.status, "unsubscribed"); assert.ok(row.unsubscribedAt); assert.equal(sent.length, 1);
});
test("SMTP explicit rejection retries are bounded, concurrent claims send once, and unsubscribe suppresses retry", async () => {
  setEmailProviderForTests({ sendEmail: async () => { throw Object.assign(new Error("rejected"), { responseCode: 451 }); } });
  assert.equal((await call("/api/waitlist/register", await submission("retry@example.com"))).status, 200);
  const row = await prisma.waitlistRegistration.findFirstOrThrow(); assert.equal(row.confirmationStatus, "failed");
  setEmailProviderForTests({ sendEmail: async input => { sent.push(input); return { messageId: "retry-accepted" }; } });
  await deliverWaitlistConfirmation(row.id); assert.equal(sent.length, 0); // cooldown
  await prisma.waitlistRegistration.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
  await Promise.all([deliverWaitlistConfirmation(row.id), deliverWaitlistConfirmation(row.id)]);
  assert.equal(sent.length, 1);
  await prisma.waitlistRegistration.update({ where: { id: row.id }, data: { confirmationStatus: "failed", confirmationAttempts: 3, nextAttemptAt: new Date(0) } });
  await deliverWaitlistConfirmation(row.id); assert.equal(sent.length, 1);
  await prisma.waitlistRegistration.update({ where: { id: row.id }, data: { status: "unsubscribed", confirmationAttempts: 1 } });
  await deliverWaitlistConfirmation(row.id); assert.equal(sent.length, 1);
});
test("ambiguous SMTP failures remain unknown and cannot be automatically retried", async () => {
  let attempts = 0;
  setEmailProviderForTests({ sendEmail: async () => { attempts++; throw new Error("connection lost after DATA"); } });
  await call("/api/waitlist/register", await submission("unknown@example.com"));
  const row = await prisma.waitlistRegistration.findFirstOrThrow(); assert.equal(row.confirmationStatus, "unknown");
  await prisma.waitlistRegistration.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
  await deliverWaitlistConfirmation(row.id); assert.equal(attempts, 1);
});
test("database rate limits hold atomically across concurrent callers", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => allowWaitlistRequest("test", "same-ip", 5)));
  assert.equal(results.filter(Boolean).length, 5);
  for (let n = 0; n < 60; n++) await call("/api/waitlist/challenge");
  const denied = await call("/api/waitlist/challenge"); assert.equal(denied.status, 429); assert.equal(denied.headers.get("retry-after"), "3600");
});
test("production origins may use waitlist only; approved app origins retain authentication; CORS has no wildcard", async () => {
  process.env.CORS_PREVIEW_ORIGINS = "https://configured-preview.vercel.app";
  for (const origin of ["https://readines.com", "https://www.readines.com"]) {
    assert.equal((await call("/api/waitlist/challenge", undefined, origin)).status, 200);
    assert.equal((await call("/api/protected", undefined, origin)).status, 403);
    assert.equal((await call("/auth/login", {}, origin)).status, 403);
  }
  for (const origin of ["http://localhost:5173", "https://frontend-web-nine-amber.vercel.app", "https://configured-preview.vercel.app"]) {
    const response = await call("/api/protected", undefined, origin);
    assert.equal(response.status, 401); assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
  for (const origin of ["https://unconfigured.vercel.app", "http://localhost:9999", "https://readines.com.evil.test"]) assert.equal(allowedBrowserOrigins().has(origin), false);
  assert.equal((await fetch(`${await base()}/api/protected`)).status, 401);
});
test("provider result reports acceptance and explicit rejection without swallowing outcome", async () => {
  assert.equal((await sendWaitlistEmail("person@example.com", "https://readines.com/")).status, "sent");
});
