/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory Prisma delegates deliberately use flexible synthetic records. */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { test } from "node:test";
import { createHmac, randomBytes, createHash, generateKeyPairSync } from "node:crypto";
import { authorizationUrl, downloadDocument, exchangeCode, normalizeIssuedDocuments, providerRequest } from "./provider";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadDigiLockerConfig } from "../../config/digilocker";

process.env.DIGILOCKER_CLIENT_ID = "synthetic-client";
process.env.DIGILOCKER_CLIENT_SECRET = "synthetic-secret";
process.env.DIGILOCKER_REDIRECT_URI = "http://localhost:4000/api/integrations/digilocker/callback";
process.env.DIGILOCKER_ENVIRONMENT = "production";
process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ test: `base64:${randomBytes(32).toString("base64")}` });
process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "test";
process.env.PRIVATE_DATA_LOOKUP_KEY = `base64:${randomBytes(32).toString("base64")}`;
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "digilocker-tests-"));
process.env.UPLOADS_DIR = path.join(tempRoot, "uploads");
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_PATH = path.join(tempRoot, "storage");
process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const originalFetch = global.fetch;
const records = new Map<string, Record<string, any>>();
const states = new Map<string, Record<string, any>>();
let downloads = 0;
let documentWrites = 0;
let usedBytes = 0;
let aiEnabled = false;
const vault = new Map<string, any>();
const temporary = new Map<string, any>();
const fake: any = {
  $transaction: async (callback: (db: any) => unknown) => callback(fake),
  $executeRaw: async () => 0,
  $queryRaw: async (parts: TemplateStringsArray) => parts.join("").includes("FOR UPDATE") ? [{ accountTier: "free", billingManaged: false }] : [{ bytes: BigInt(usedBytes) }],
  user: { findUnique: async () => ({ aiProcessingEnabled: aiEnabled }) },
  userAIUsage: { upsert: async () => ({ actionCount: 3 }) },
  temporaryUpload: {
    create: async ({ data }: any) => { temporary.set(data.id, data); return data; },
    delete: async ({ where }: any) => { temporary.delete(where.id); },
  },
  documentFile: { create: async ({ data }: any) => {
    const fields = new Set(Prisma.dmmf.datamodel.models.find(model => model.name === "DocumentFile")!.fields.map(field => field.name));
    assert.deepEqual(Object.keys(data).filter(key => !fields.has(key)), [], "DigiLocker page writes must match the actual Prisma DocumentFile schema");
    assert.equal(data.ciphertextHash, data.encryptedSha256);
    return data;
  } },
  externalOAuthState: {
    create: async ({ data }: any) => { const row = { id: randomBytes(8).toString("hex"), usedAt: null, ...data }; states.set(row.stateHash, row); return row; },
    findUnique: async ({ where }: any) => states.get(where.stateHash) ?? null,
    updateMany: async ({ where, data }: any) => { const row = [...states.values()].find(s => s.id === where.id && s.usedAt === null); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
  },
  digiLockerConsentSession: {
    create: async ({ data }: any) => { const row = { cancelledAt: null, ...data }; records.set(row.id, row); return structuredClone(row); },
    findFirst: async ({ where }: any) => { const row = records.get(where.id); return row && row.userId === where.userId ? structuredClone(row) : null; },
    update: async ({ where, data }: any) => { const row = records.get(where.id)!; Object.assign(row, data); return structuredClone(row); },
    updateMany: async ({ where, data }: any) => { const row = records.get(where.id); if (!row || row.status !== where.status || (where.cancelledAt === null && row.cancelledAt)) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
  },
  document: {
    findFirst: async ({ where }: any) => [...vault.values()].find(row => row.ownerProfileId === where.ownerProfileId && where.OR.some((clause: any) => Object.entries(clause).every(([key, value]) => row[key] === value))) ?? null,
    create: async ({ data }: any) => { documentWrites++; vault.set(data.id, data); return data; },
  },
};
global.__prisma__ = fake;

async function suite() {
  const service = await import("./digilocker.service");
  await test("missing migration does not crash cleanup; other database errors remain visible", async () => {
    const execute = fake.$executeRaw;
    const now = Date.now;
    const warn = console.warn;
    const warnings: unknown[] = [];
    try {
      console.warn = entry => { warnings.push(entry); };
      fake.$executeRaw = async () => { throw { code: "P2010", meta: { code: "42703", message: 'column "encryptedCredentials" does not exist' } }; };
      await assert.doesNotReject(service.cleanupExpiredDigiLockerCredentials());
      assert.equal(warnings.length, 1);
      await assert.doesNotReject(service.cleanupExpiredDigiLockerCredentials());
      assert.equal(warnings.length, 1);
      Date.now = () => now() + 61_000;
      fake.$executeRaw = async () => { throw new Error("database unavailable"); };
      await assert.rejects(service.cleanupExpiredDigiLockerCredentials(), /database unavailable/);
      fake.$executeRaw = execute;
      await assert.doesNotReject(service.cleanupExpiredDigiLockerCredentials());
    } finally { fake.$executeRaw = execute; Date.now = now; console.warn = warn; }
  });
  await test("configuration fails closed and authorization contains PKCE but no secret", () => {
    assert(loadDigiLockerConfig().configured);
    const url = new URL(authorizationUrl("test-state", "test-challenge"));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("state"), "test-state");
    assert(!url.toString().includes("synthetic-secret"));
    process.env.DIGILOCKER_ENVIRONMENT = "sandbox";
    assert(!loadDigiLockerConfig().configured);
    process.env.DIGILOCKER_ENVIRONMENT = "production";
  });
  await test("document list comes from real provider items, excludes duplicates, marks restrictions and XML-only files", () => {
    const docs = normalizeIssuedDocuments([
      { uri: "in.gov.board-CERT-1", name: "Certificate", mime: ["application/PDF"], date: "2026-01-02" },
      { uri: "in.gov.board-CERT-1", mime: "application/pdf" },
      { uri: "in.gov.uidai-ADHAR-1", name: "Aadhaar", mime: "application/pdf" },
      { uri: "xml-only", mime: "application/xml" },
      { name: "No reference", mime: "application/pdf" },
    ]);
    assert.equal(docs.length, 3); assert(docs[0].available); assert.equal(docs[0].issueDate, null);
    assert.equal(docs[0].modifiedAt, "2026-01-02"); assert(!docs[1].available); assert(!docs[2].available);
  });
  await test("download requires provider HMAC, correct MIME and bounded content, with redirects disabled", async () => {
    const content = Buffer.from("%PDF-synthetic-data");
    global.fetch = async (url, init) => {
      assert(String(url).startsWith("https://digilocker.meripehchaan.gov.in/public/oauth2/1/file/"));
      assert.equal(init?.redirect, "error");
      return new Response(content, { headers: { "Content-Type": "application/pdf", hmac: createHmac("sha256", "synthetic-secret").update(content).digest("base64") } });
    };
    assert.deepEqual(await downloadDocument("synthetic-token", "allowed-reference"), content);
    global.fetch = async () => new Response(content, { headers: { "Content-Type": "application/pdf", hmac: "bad" } });
    await assert.rejects(downloadDocument("synthetic-token", "reference"));
    global.fetch = async () => new Response("12345");
    await assert.rejects(providerRequest("/test", {}, 4));
  });
  const start = () => service.startDigiLockerSession({ userId: "owner-a" });
  const callbackState = (session: any) => new URL(session.authorizationUrl).searchParams.get("state")!;
  await test("invalid, expired and replayed OAuth state is rejected before token exchange", async () => {
    global.fetch = async () => { throw new Error("must not exchange"); };
    await assert.rejects(service.completeDigiLockerAuthorization({ state: "invalid-state", code: "code" }));
    const expired = await start(); states.get(createHash("sha256").update(callbackState(expired)).digest("hex"))!.expiresAt = new Date(0);
    await assert.rejects(service.completeDigiLockerAuthorization({ state: callbackState(expired), code: "code" }));
    const denied = await start();
    assert.equal((await service.completeDigiLockerAuthorization({ state: callbackState(denied), denied: true })).status, "CONSENT_DENIED");
    await assert.rejects(service.completeDigiLockerAuthorization({ state: callbackState(denied), code: "code" }));
  });
  await test("authorization exchanges verifier on backend, encrypts credentials, and exposes only granted provider metadata", async () => {
    const session = await start();
    global.fetch = async (url, init) => {
      if (String(url).endsWith("/token")) {
        const body = init?.body as URLSearchParams;
        assert.equal(body.get("client_secret"), "synthetic-secret");
        assert.equal(body.get("code_verifier")!.length, 86);
        return Response.json({ access_token: "synthetic-token", expires_in: 1800, token_type: "Bearer", scope: "files.issueddocs issued/in.gov.board-CERT-1", refresh_token: "must-discard" });
      }
      if (String(url).endsWith("/files/issued")) return Response.json({ items: [{ uri: "in.gov.board-CERT-1", name: "Certificate", mime: "application/pdf" }] });
      downloads++; throw new Error("not a list call");
    };
    assert.equal((await service.completeDigiLockerAuthorization({ state: callbackState(session), code: "code" })).status, "AUTHENTICATED");
    const raw = records.get(session.id)!;
    assert.match(raw.encryptedCredentials, /^enc:v2:/);
    assert(!JSON.stringify(raw).includes("synthetic-token")); assert(!JSON.stringify(raw).includes("must-discard"));
    const listing = await service.listDigiLockerDocuments("owner-a", session.id);
    assert.equal(listing.documents.length, 1); assert.equal(downloads, 0);
    assert(!JSON.stringify(listing).includes("synthetic-token"));
    await assert.rejects(service.listDigiLockerDocuments("owner-b", session.id), { statusCode: 404 });
    for (const bad of [{ consent: false, references: ["in.gov.board-CERT-1"] }, { consent: true, references: ["unselected"] }]) {
      await assert.rejects(service.importDigiLockerDocuments({ userId: "owner-a", sessionId: session.id, consentVersion: service.COPY_CONSENT_VERSION, ...bad }));
    }
    assert.equal(downloads, 0); assert.equal(documentWrites, 0);
    global.fetch = async () => new Response("");
    await service.cancelDigiLockerSession("owner-a", session.id);
    assert.equal(records.get(session.id)!.encryptedCredentials, null);
    await assert.rejects(service.listDigiLockerDocuments("owner-a", session.id));
  });
  await test("token exchange failure never exposes provider body or stores a successful session", async () => {
    const session = await start();
    global.fetch = async () => new Response("PRIVATE PROVIDER ERROR synthetic-secret", { status: 403 });
    const result = await service.completeDigiLockerAuthorization({ state: callbackState(session), code: "code" });
    assert.equal(result.status, "FAILED"); assert.equal(records.get(session.id)!.encryptedCredentials, null);
    await assert.rejects(exchangeCode("code", "verifier"), error => !String(error).includes("PRIVATE PROVIDER ERROR"));
  });
  await test("real encryption/storage pipeline preserves partial success, deduplicates retries, enforces quota and removes temporary files", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { decryptHybridDocument, resetDocumentEncryptionKeysForTests } = await import("../documentHybridEncryption");
    const keys = generateKeyPairSync("rsa", { modulusLength: 4096, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    process.env.DOCUMENT_RSA_KEYRING_JSON = JSON.stringify([{ keyId: "test", keyVersion: 1, publicKeyPem: keys.publicKey, privateKeyPem: keys.privateKey }]);
    process.env.DOCUMENT_RSA_ACTIVE_KEY_ID = "test"; process.env.DOCUMENT_RSA_ACTIVE_KEY_VERSION = "1";
    resetDocumentEncryptionKeysForTests();
    const pdf = await PDFDocument.create(); pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    const session = await start();
    let failSecond = true;
    global.fetch = async (url) => {
      const route = String(url);
      if (route.endsWith("/token")) return Response.json({ access_token: "test-token", token_type: "Bearer", expires_in: 1800 });
      if (route.endsWith("/files/issued")) return Response.json({ items: ["one", "two"].map(uri => ({ uri, name: uri, mime: "application/pdf" })) });
      if (route.endsWith("/file/two") && failSecond) return new Response("denied", { status: 403 });
      return new Response(bytes, { headers: { "Content-Type": "application/pdf", hmac: createHmac("sha256", "synthetic-secret").update(bytes).digest("base64") } });
    };
    await service.completeDigiLockerAuthorization({ state: callbackState(session), code: "code" });
    const input = { userId: "owner-a", sessionId: session.id, references: ["one", "two"], consent: true, consentVersion: service.COPY_CONSENT_VERSION };
    const first = await service.importDigiLockerDocuments(input);
    assert.equal(first.progress.find(p => p.reference === "one")!.phase, "Completed");
    assert.equal(first.progress.find(p => p.reference === "two")!.phase, "Failed");
    assert.equal(vault.size, 1); assert.equal(temporary.size, 0);
    const stored = [...vault.values()][0];
    const encryptedBytes = await fs.readFile(path.join(process.env.LOCAL_STORAGE_PATH!, stored.storageKey));
    assert(!encryptedBytes.equals(bytes)); assert(!encryptedBytes.includes(Buffer.from("%PDF-")));
    assert.deepEqual(decryptHybridDocument(encryptedBytes, { ...stored, iv: stored.encryptionIv }), bytes);
    assert.equal(stored.analysisSource, "manual");
    assert.deepEqual(await fs.readdir(path.join(process.env.UPLOADS_DIR!, "tmp")), []);
    failSecond = false;
    const retry = await service.importDigiLockerDocuments({ ...input, references: ["two"] });
    assert.equal(retry.progress.find(p => p.reference === "two")!.phase, "Completed");
    assert.equal(vault.size, 1); // identical bytes deduplicate, including another provider reference
    const writes = documentWrites;
    await service.importDigiLockerDocuments(input);
    assert.equal(documentWrites, writes);
    const { storeLockerDocument } = await import("./importer");
    const file = { reference: "three", name: "three", type: "Certificate", issuer: null, issueDate: null, modifiedAt: null, available: true, reason: null, mimeType: "application/pdf" };
    const secondPdf = await PDFDocument.create(); secondPdf.addPage([200, 200]); const secondBytes = Buffer.from(await secondPdf.save());
    usedBytes = 50 * 1024 * 1024;
    await assert.rejects(storeLockerDocument("owner-a", file, secondBytes, { sessionId: session.id, id: "consent", timestamp: new Date().toISOString(), version: "v1" }, async () => undefined), { code: "STORAGE_LIMIT_EXCEEDED" });
    assert.equal(temporary.size, 0); usedBytes = 0;
    // AI allowance exhausted: encrypted import succeeds with manual review and no provider AI call.
    aiEnabled = true;
    const { setDocumentAnalyzerForTests } = await import("../documentAnalyzer");
    setDocumentAnalyzerForTests({ analyzeDocument: async () => { throw new Error("AI must not be invoked when quota is exhausted"); } });
    const manual = await storeLockerDocument("owner-a", file, secondBytes, { sessionId: session.id, id: "consent", timestamp: new Date().toISOString(), version: "v1" }, async () => undefined);
    assert.equal(vault.get(manual.documentId).analysisSource, "manual");
    assert.equal(temporary.size, 0);
    assert.deepEqual(await fs.readdir(path.join(process.env.UPLOADS_DIR!, "tmp")), []);
  });

}
void suite().finally(async () => { global.fetch = originalFetch; await fs.rm(tempRoot, { recursive: true, force: true }); }).catch(error => { console.error(error); process.exitCode = 1; });
