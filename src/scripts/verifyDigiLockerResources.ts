import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { randomBytes, randomUUID, createHmac, generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { withPrivateUser } from "../privacy/access";

const url = process.env.DIGILOCKER_TEST_DATABASE_URL;
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/readines_integration(?:\?|$)/.test(url)) throw new Error("Use only the disposable readines_integration database.");
process.env.DATABASE_URL = `${url}?connection_limit=1`; process.env.DIRECT_URL = url;
process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "resources";
process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ resources: `base64:${randomBytes(32).toString("base64")}` });
process.env.PRIVATE_DATA_LOOKUP_KEY = `base64:${randomBytes(32).toString("base64")}`;
process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.DIGILOCKER_CLIENT_ID = "synthetic"; process.env.DIGILOCKER_CLIENT_SECRET = "synthetic-secret";
process.env.DIGILOCKER_REDIRECT_URI = "http://localhost:4000/api/integrations/digilocker/callback";
process.env.DIGILOCKER_ENVIRONMENT = "production";
const keys = generateKeyPairSync("rsa", { modulusLength: 4096, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
process.env.DOCUMENT_RSA_KEYRING_JSON = JSON.stringify([{ keyId: "resources", keyVersion: 1, publicKeyPem: keys.publicKey, privateKeyPem: keys.privateKey }]);
process.env.DOCUMENT_RSA_ACTIVE_KEY_ID = "resources"; process.env.DOCUMENT_RSA_ACTIVE_KEY_VERSION = "1";
const percentile = (samples: number[], p: number) => [...samples].sort((a, b) => a - b)[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)];
const stats = (samples: number[]) => ({ samples: samples.length, p95Ms: percentile(samples, .95), p99Ms: percentile(samples, .99) });
const memory = () => ({ ...process.memoryUsage(), maxRssBytes: process.resourceUsage().maxRSS * 1024 });

async function main() {
  const { prisma } = await import("../lib/prisma");
  const { PostgresRateLimitStore } = await import("../middleware/postgresRateLimitStore");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "digilocker-resources-"));
  process.env.UPLOADS_DIR = path.join(directory, "uploads"); process.env.LOCAL_STORAGE_PATH = path.join(directory, "storage"); process.env.STORAGE_DRIVER = "local";
  const service = await import("../services/digilocker/digilocker.service");
  const { runDigiLockerWorker } = await import("../services/digilocker/worker");
  const { PDFDocument, PDFName } = await import("pdf-lib");
  const owner = randomUUID(); const originalFetch = global.fetch;
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  let large = false, activeDownloads = 0, maximumDownloads = 0;
  const asOwner = <T>(work: () => T) => withPrivateUser(owner, work);
  const queueLatency: number[] = [], importLatency: number[] = [];
  const rateLimits: unknown[] = [];
  try {
    await asOwner(() => prisma.user.create({ data: { id: owner, name: "Resource fixture", email: `${owner}@example.invalid`, aiProcessingEnabled: false } }));
    global.fetch = async (input) => {
      const route = String(input);
      if (route.endsWith("/token")) return Response.json({ access_token: "synthetic", token_type: "Bearer", expires_in: 1800 });
      if (route.endsWith("/files/issued")) return Response.json({ items: [{ uri: randomUUID(), name: "Synthetic PDF", mime: "application/pdf" }] });
      if (route.endsWith("/revoke")) return new Response("");
      activeDownloads++; maximumDownloads = Math.max(maximumDownloads, activeDownloads);
      try {
        const synthetic = await PDFDocument.create(); const page = synthetic.addPage(); synthetic.setSubject(randomUUID());
        if (large) page.node.set(PDFName.of("Contents"), synthetic.context.register(synthetic.context.stream(Buffer.alloc(9 * 1024 * 1024, 32))));
        const content = Buffer.from(await synthetic.save({ useObjectStreams: false }));
        return new Response(content, { headers: { "Content-Type": "application/pdf", hmac: createHmac("sha256", "synthetic-secret").update(content).digest("base64") } });
      } finally { activeDownloads--; }
    };
    const enqueue = () => asOwner(async () => {
      const session = await service.startDigiLockerSession({ userId: owner });
      await service.completeDigiLockerAuthorization({ state: new URL(session.authorizationUrl).searchParams.get("state")!, code: "synthetic" });
      const listing = await service.listDigiLockerDocuments(owner, session.id);
      const start = performance.now();
      await service.importDigiLockerDocuments({ userId: owner, sessionId: session.id, references: [listing.documents[0].reference], consent: true, consentVersion: service.COPY_CONSENT_VERSION });
      queueLatency.push(performance.now() - start);
      return session.id;
    });
    for (let index = 0; index < 20; index++) {
      const id = await enqueue(); const start = performance.now(); await runDigiLockerWorker(); importLatency.push(performance.now() - start);
      assert.equal((await asOwner(() => service.refreshDigiLockerSession(owner, id))).progress[0].phase, "Completed");
    }
    const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    gc?.(); const before = memory(); large = true;
    const ids = await Promise.all(Array.from({ length: 3 }, enqueue));
    await Promise.all(ids.map(() => runDigiLockerWorker()));
    for (const id of ids) { const result = await asOwner(() => service.refreshDigiLockerSession(owner, id)); assert.equal(result.progress[0].phase, "Completed", JSON.stringify(result.progress)); }
    const afterImports = memory(); gc?.(); const afterGc = memory();
    for (const clientsCount of [1, 8, 32]) {
      const clients = Array.from({ length: clientsCount }, () => new PrismaClient({ datasources: { db: { url: `${url}?connection_limit=1` } }, log: [] }));
      const stores = clients.map(client => new PostgresRateLimitStore(`resources-${owner}`, 60000, client));
      const key = randomUUID(); const samples: number[] = [];
      try {
        await Promise.all(clients.map(client => client.$connect()));
        const connections = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()`;
        await Promise.all(stores.map(async store => {
          for (let n = 0; n < 20; n++) { const start = performance.now(); await store.increment(key); samples.push(performance.now() - start); }
        }));
        rateLimits.push({ clients: clientsCount, connections: Number(connections[0].count), ...stats(samples), failures: 0 });
        await stores[0].resetKey(key);
      } finally { await Promise.all(clients.map(client => client.$disconnect())); }
    }
    console.log(JSON.stringify({ environment: "Local disposable PostgreSQL; synthetic provider; AI disabled. No production baseline or serverless equivalence claimed.", queueAdmission: stats(queueLatency), smallPdfWorker: stats(importLatency), largePdfs: { count: 3, bytesEach: 9 * 1024 * 1024, maximumDownloads, before, afterImports, afterGc }, rateLimits }, null, 2));
  } finally {
    global.fetch = originalFetch;
    await asOwner(() => prisma.user.delete({ where: { id: owner } })); await prisma.$disconnect(); await fs.rm(directory, { recursive: true, force: true });
  }
}
void main().catch((error) => { console.error(error instanceof assert.AssertionError ? error.message : { name: error?.name, code: error?.code ?? "RESOURCE_VERIFICATION_FAILED" }); process.exitCode = 1; });
