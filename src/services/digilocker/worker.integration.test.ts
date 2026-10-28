import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, randomBytes, createHmac, generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { withPrivateUser } from "../../privacy/access";

const url = process.env.DIGILOCKER_TEST_DATABASE_URL;
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/readines_integration(?:\?|$)/.test(url)) {
  throw new Error("Use only the disposable readines_integration database on 127.0.0.1:55439.");
}
process.env.DATABASE_URL = url; process.env.DIRECT_URL = url;
process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "integration";
process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ integration: `base64:${randomBytes(32).toString("base64")}` });
process.env.PRIVATE_DATA_LOOKUP_KEY = `base64:${randomBytes(32).toString("base64")}`;
process.env.DIGILOCKER_CLIENT_ID = "synthetic-client";
process.env.DIGILOCKER_CLIENT_SECRET = "synthetic-secret";
process.env.DIGILOCKER_REDIRECT_URI = "http://localhost:4000/api/integrations/digilocker/callback";
process.env.DIGILOCKER_ENVIRONMENT = "production";
process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const keys = generateKeyPairSync("rsa", { modulusLength: 4096, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
process.env.DOCUMENT_RSA_KEYRING_JSON = JSON.stringify([{ keyId: "integration", keyVersion: 1, publicKeyPem: keys.publicKey, privateKeyPem: keys.privateKey }]);
process.env.DOCUMENT_RSA_ACTIVE_KEY_ID = "integration"; process.env.DOCUMENT_RSA_ACTIVE_KEY_VERSION = "1";

void test("durable imports with real PostgreSQL and a synthetic DigiLocker boundary", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "digilocker-integration-"));
  process.env.UPLOADS_DIR = path.join(directory, "uploads"); process.env.LOCAL_STORAGE_PATH = path.join(directory, "storage"); process.env.STORAGE_DRIVER = "local";
  const { prisma } = await import("../../lib/prisma");
  const service = await import("./digilocker.service");
  const { runDigiLockerWorker, maintainDigiLockerSessions } = await import("./worker");
  const { storeLockerDocument } = await import("./importer");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  const owner = randomUUID(), other = randomUUID();
  const originalFetch = global.fetch;
  let downloads = 0, revocations = 0, fail = false, failRevoke = false;
  let slowDownload: ((signal: AbortSignal) => Promise<Response>) | undefined;
  global.fetch = async (input, init) => {
    const route = String(input);
    if (route.endsWith("/token")) return Response.json({ access_token: "synthetic-token", token_type: "Bearer", expires_in: 1800 });
    if (route.endsWith("/revoke")) { revocations++; return new Response("", { status: failRevoke ? 503 : 200 }); }
    if (route.endsWith("/files/issued")) return Response.json({ items: ["one", "two", "three", "crash"].map(uri => ({ uri, name: uri, mime: "application/pdf" })) });
    downloads++;
    if (slowDownload) return slowDownload(init!.signal!);
    if (fail) return new Response("unavailable", { status: 503 });
    return new Response(bytes, { headers: { "Content-Type": "application/pdf", hmac: createHmac("sha256", "synthetic-secret").update(bytes).digest("base64") } });
  };
  const asOwner = <T>(work: () => T) => withPrivateUser(owner, work);
  const connect = () => asOwner(async () => {
    const started = await service.startDigiLockerSession({ userId: owner });
    await service.completeDigiLockerAuthorization({ state: new URL(started.authorizationUrl).searchParams.get("state")!, code: "synthetic-code" });
    return started.id;
  });
  const enqueue = (id: string, references = ["one"]) => asOwner(() => service.importDigiLockerDocuments({ userId: owner, sessionId: id, references, consent: true, consentVersion: service.COPY_CONSENT_VERSION }));
  const status = (id: string) => asOwner(() => service.refreshDigiLockerSession(owner, id));
  try {
    await asOwner(() => prisma.user.create({ data: { id: owner, name: "Queue fixture", email: `${owner}@example.invalid`, aiProcessingEnabled: false } }));
    await t.test("admission persists consent without downloading; concurrent enqueue has one winner and cross-account reads fail", async () => {
      const id = await connect();
      const results = await Promise.allSettled([enqueue(id), enqueue(id)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(downloads, 0);
      await assert.rejects(withPrivateUser(other, () => service.refreshDigiLockerSession(other, id)), { statusCode: 404 });
      await runDigiLockerWorker();
      assert.equal((await status(id)).progress[0].phase, "Completed");
      const before = downloads;
      await enqueue(id); await runDigiLockerWorker();
      assert.equal(downloads, before, "completed references are not downloaded again");
    });
    await t.test("expired worker leases resume after a simulated crash; stale workers cannot commit", async () => {
      const id = await connect(); await enqueue(id, ["two"]);
      await prisma.$executeRaw`UPDATE "digilocker_consent_sessions" SET "importLeaseToken" = 'crashed-worker', "importLeaseUntil" = timezone('UTC', CURRENT_TIMESTAMP) - INTERVAL '1 second' WHERE "id" = ${id}`;
      await runDigiLockerWorker(); assert.equal((await status(id)).status, "AUTHENTICATED");
      const stalePdf = await PDFDocument.create(); stalePdf.addPage([300, 300]);
      const staleBytes = Buffer.from(await stalePdf.save());
      await assert.rejects(asOwner(() => storeLockerDocument(owner,
        { reference: "stale", name: "stale", type: "Document", issuer: null, issueDate: null, modifiedAt: null, mimeType: "application/pdf", available: true, reason: null },
        staleBytes, { sessionId: id, id: "stale-consent", timestamp: new Date().toISOString(), version: service.COPY_CONSENT_VERSION }, async () => undefined,
        { token: "crashed-worker", signal: new AbortController().signal })), /lease ended/);
    });
    await t.test("an actual worker process death retains its lease and resumes without duplicate writes", async () => {
      const id = await connect(); await enqueue(id, ["crash"]);
      const child = fork(path.resolve("src/services/digilocker/workerCrash.fixture.ts"), [], {
        execArgv: ["--import", "tsx"], env: process.env, stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const [message] = await Promise.race([once(child, "message"), new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Crash fixture did not reach provider I/O")), 10_000);
        })]);
        assert.deepEqual(message, { event: "download-started" });
        const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
        const abandoned = await asOwner(() => prisma.digiLockerConsentSession.findFirstOrThrow({ where: { id, userId: owner } }));
        assert.equal(abandoned.status, "IMPORTING"); assert(abandoned.importLeaseToken);
        await prisma.$executeRaw`UPDATE "digilocker_consent_sessions" SET "importLeaseUntil" = timezone('UTC', CURRENT_TIMESTAMP) - INTERVAL '1 second' WHERE "id" = ${id}`;
        await runDigiLockerWorker();
        assert.equal((await status(id)).progress[0].phase, "Completed");
        const before = downloads; await runDigiLockerWorker(); assert.equal(downloads, before);
      } finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
    });
    await t.test("partial failure and retry timing survive a new worker invocation", async () => {
      const id = await connect(); await enqueue(id, ["three"]); fail = true;
      await runDigiLockerWorker(); const partial = await status(id);
      assert.equal(partial.status, "IMPORTING"); assert.equal(partial.progress[0].phase, "Failed");
      const before = downloads; await runDigiLockerWorker(); assert.equal(downloads, before, "honor durable retry time");
      fail = false;
      await prisma.$executeRaw`UPDATE "digilocker_consent_sessions" SET "importNextAttemptAt" = timezone('UTC', CURRENT_TIMESTAMP) - INTERVAL '1 second' WHERE "id" = ${id}`;
      const retried = await runDigiLockerWorker();
      const retriedStatus = await status(id);
      assert.equal(retriedStatus.progress[0].phase, "Completed", JSON.stringify({ retried, status: retriedStatus }));
    });
    await t.test("cancel fences a live worker and aborts its provider request; terminal credentials are revoked", async () => {
      const id = await connect(); await enqueue(id, ["three"]);
      let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
      let aborted = false;
      slowDownload = signal => new Promise((_resolve, reject) => { entered(); signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true }); });
      const running = runDigiLockerWorker(); await started;
      await asOwner(() => service.cancelDigiLockerSession(owner, id));
      await running; slowDownload = undefined;
      assert(aborted); assert.equal((await status(id)).status, "CANCELLED");
      const row = await asOwner(() => prisma.digiLockerConsentSession.findFirstOrThrow({ where: { id, userId: owner } }));
      assert.equal(row.encryptedCredentials, null); assert(revocations > 0);
    });
    await t.test("admission remains bounded across four concurrent workers and cancel fences every lease", async () => {
      const ids = await Promise.all(Array.from({ length: 4 }, connect));
      for (const id of ids) await enqueue(id, ["three"]);
      let entered = 0, ready!: () => void;
      const admitted = new Promise<void>(resolve => { ready = resolve; });
      slowDownload = signal => new Promise((_resolve, reject) => {
        if (++entered === 3) ready();
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      const workers = Promise.allSettled(Array.from({ length: 4 }, () => runDigiLockerWorker()));
      await admitted;
      assert.equal(await asOwner(() => prisma.digiLockerConsentSession.count({ where: { userId: owner, status: "IMPORTING", importLeaseUntil: { gt: new Date() } } })), 3);
      for (const id of ids) await asOwner(() => service.cancelDigiLockerSession(owner, id));
      const results = await workers; slowDownload = undefined; assert.equal(entered, 3);
      assert.equal(results.filter(result => result.status === "rejected").length, 1);
    });
    await t.test("failed token revocation is retried durably without reactivating the connection", async () => {
      const id = await connect(); failRevoke = true;
      await asOwner(() => service.cancelDigiLockerSession(owner, id));
      const retained = await asOwner(() => prisma.digiLockerConsentSession.findFirstOrThrow({ where: { id, userId: owner } }));
      assert(retained.encryptedCredentials); assert.equal(retained.status, "CANCELLED");
      failRevoke = false; await maintainDigiLockerSessions();
      const cleared = await asOwner(() => prisma.digiLockerConsentSession.findFirstOrThrow({ where: { id, userId: owner } }));
      assert.equal(cleared.encryptedCredentials, null); assert.equal(cleared.status, "CANCELLED");
    });
    await t.test("invocation timeouts retain durable progress for retry instead of stranding IMPORTING", async () => {
      const id = await connect(); await enqueue(id, ["three"]);
      slowDownload = signal => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      await runDigiLockerWorker(20); slowDownload = undefined;
      const interrupted = await status(id); assert.equal(interrupted.status, "IMPORTING");
      await prisma.$executeRaw`UPDATE "digilocker_consent_sessions" SET "importNextAttemptAt" = timezone('UTC', CURRENT_TIMESTAMP) - INTERVAL '1 second' WHERE "id" = ${id}`;
      await runDigiLockerWorker(); assert.equal((await status(id)).progress[0].phase, "Completed");
    });
    await t.test("invalid progress ciphertext terminates the job and independently revokes credentials", async () => {
      const id = await connect(); await enqueue(id, ["three"]);
      await prisma.$executeRaw`UPDATE "digilocker_consent_sessions" SET "encryptedProgress" = "encryptedPayload" WHERE "id" = ${id}`;
      await runDigiLockerWorker();
      const row = await asOwner(() => prisma.digiLockerConsentSession.findFirstOrThrow({ where: { id, userId: owner } }));
      assert.equal(row.status, "FAILED"); assert.equal(row.importLeaseToken, null); assert.equal(row.encryptedCredentials, null);
    });
    await t.test("maintenance expires interrupted sessions without restoring authenticated state", async () => {
      const id = await connect(); await enqueue(id, ["three"]);
      await prisma.$executeRaw`UPDATE "digilocker_consent_sessions" SET "expiresAt" = timezone('UTC', CURRENT_TIMESTAMP) - INTERVAL '1 second' WHERE "id" = ${id}`;
      await maintainDigiLockerSessions(); assert.equal((await status(id)).status, "EXPIRED");
      await assert.rejects(enqueue(id));
    });
  } finally {
    global.fetch = originalFetch;
    await asOwner(() => prisma.user.delete({ where: { id: owner } }));
    await prisma.$disconnect(); await fs.rm(directory, { recursive: true, force: true });
  }
});
