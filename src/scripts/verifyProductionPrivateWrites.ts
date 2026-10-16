import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { assertVercelMigrationContext } from "../privacy/vercelMigration";
import { productionTargetSummary } from "../privacy/productionTargetSummary";
import { assertPrivateDataKeysConfigured } from "../privacy/fieldEncryption";
import { withPrivateMigration, withPrivateUser } from "../privacy/access";
import { operationalProjection } from "../privacy/operationalFields";

// Synthetic fixtures only, inside the existing Vercel production build. Never
// exports secrets; requires actual coordinated maintenance/backup references.
assertVercelMigrationContext("constraints", process.env);
assertPrivateDataKeysConfigured();
const targets = productionTargetSummary(process.env);
if (targets.databaseProjectRef !== "izsujcwyuirkzkafhfnp" || targets.directProjectRef !== targets.databaseProjectRef || targets.storageProjectRef !== targets.databaseProjectRef) throw new Error("PRODUCTION_TARGET_MISMATCH");
// Keep offline verification on the existing session connection, not the runtime pool.
process.env.DATABASE_URL = process.env.DIRECT_URL;
const raw = new PrismaClient({ log: [] });
const userId = randomUUID(), otherId = randomUUID(), marker = `SYNTHETIC-PRIVATE-${randomUUID()}`;
async function counts() {
  const tables = await raw.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  const result: Record<string, number> = {};
  for (const { table_name: table } of tables) {
    assert(/^[A-Za-z_]+$/.test(table));
    result[table] = (await raw.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${table}"`))[0].n;
  }
  return result;
}
let stage = "fixture-setup";
async function run() {
  const { prisma } = await import("../lib/prisma");
  const email = await import("../services/email/emailService");
  email.setEmailProviderForTests({ sendEmail: async () => ({}) });
  const health = await import("../services/health.service");
  const wealth = await import("../services/wealthRecords.service");
  const extraction = await import("../services/healthExtraction.service");
  const storage = await import("../services/documentFileStorage");
  const { encryptDocumentOnBackend } = await import("../services/documentHybridEncryption");
  const { getStorageProvider } = await import("../infrastructure/storage/createStorageProvider");
  const before = await counts();
  let storedKey: string | undefined, tempPath: string | undefined;
  const exportKeys: string[] = [];
  const password = `Synthetic-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(password, 4);
  try {
    await withPrivateMigration("synthetic local verification users only", () => prisma.user.createMany({ data: [userId, otherId].map(id => ({ id, email: `${id}@example.test`, name: marker, passwordHash, aiProcessingEnabled: false })) }));
    let memberId = "";
    await withPrivateUser(userId, async () => {
      const member = await health.createHealthMember(userId, { name: marker, relation: "Myself", conditions: marker }); memberId = member.id;
      const original = await raw.healthMember.findUniqueOrThrow({ where: { id: member.id } });
      await health.updateHealthMember(userId, member.id, { name: `${marker}-updated`, conditions: marker });
      const updated = await raw.healthMember.findUniqueOrThrow({ where: { id: member.id } });
      assert.notEqual(original.private_name, updated.private_name);
      assert(updated.private_name?.startsWith("enc:v2:"));
      await health.createManualMeasurement(userId, member.id, { metricKey: "blood_glucose", displayName: marker, value: 143.284019, unit: "mg/dL", measuredAt: "2026-01-11" });
      const medication = await health.createManualMedication(userId, member.id, { name: marker, dose: "10 mg", whenToTake: ["morning"], mealTiming: "after_food" });
      await health.updateMedication(userId, medication.id, { dose: "20 mg" });
      const financialInput = { type: "ASSET", title: marker, details: { provider: marker, amount: 12345.67 }, notes: marker };
      const financial = await wealth.createWealthRecord(userId, financialInput);
      await wealth.updateWealthRecord(userId, financial.id, { ...financialInput, title: `${marker}-updated` });
      const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
      pdf.addPage().drawText("SYNTHETIC TEST DOCUMENT. Laboratory glucose 103 mg/dL. No real patient.", { x: 30, y: 700, size: 12, font });
      const bytes = Buffer.from(await pdf.save());
      const envelope = encryptDocumentOnBackend(bytes, { filename: `${marker}.pdf`, mimeType: "application/pdf" });
      const temporary = await storage.createEncryptedTemporaryUpload(userId, envelope); tempPath = temporary.storagePath;
      const docId = randomUUID(); const stored = await storage.saveEncryptedPermanentFile(userId, docId, temporary); storedKey = stored.storageKey;
      const originalObject = await getStorageProvider().download(storedKey);
      assert(!originalObject.includes(Buffer.from("SYNTHETIC TEST DOCUMENT"))); assert(!originalObject.subarray(0, 4).equals(Buffer.from("%PDF")));
      const document = await prisma.document.create({ data: { id: docId, ...stored, ownerProfileId: userId, originalName: `${marker}.pdf`, mimeType: "application/pdf", size: bytes.length, documentType: "medical", category: "medical", analysisSource: "manual", confidence: 100, fields: { note: marker } } });
      let calls = 0;
      extraction.setHealthExtractionRequestForTests(async body => {
        calls++; assert.equal(body.store, false);
        const text = JSON.stringify(body.input); assert(text.includes(`data:application/pdf;base64,${bytes.toString("base64")}`));
        return { output_text: JSON.stringify({ documentType: "lab_report", provider: marker, patient: null, measurements: [{ name: "Glucose", value: 103, unit: "mg/dL" }], medications: [], followUps: [] }) };
      });
      const manual = await health.createHealthRecord(userId, { memberId: member.id, documentId: document.id, type: "lab_report" });
      assert.equal(manual.processingStatus, "ai_processing_disabled"); assert.equal(calls, 0);
      await prisma.user.update({ where: { id: userId }, data: { aiProcessingEnabled: true } });
      await health.reprocessHealthRecord(userId, manual.id); assert.equal(calls, 1);
      const readings = await raw.healthMeasurement.findMany({ where: { userId, sourceDocumentId: manual.id } }); assert.equal(readings.length, 1);
      extraction.setHealthExtractionRequestForTests(async () => { throw new Error(marker); });
      const failed = await health.reprocessHealthRecord(userId, manual.id); assert.equal(failed.processingStatus, "failed"); assert(!JSON.stringify(failed.processingError).includes(marker));
      await prisma.user.update({ where: { id: userId }, data: { aiProcessingEnabled: false } });
      const disabled = await health.reprocessHealthRecord(userId, manual.id); assert.equal(disabled.processingStatus, "ai_processing_disabled");
      assert.deepEqual((await raw.healthMeasurement.findMany({ where: { userId, sourceDocumentId: manual.id } })).map(row => row.id), readings.map(row => row.id));
      for (const rows of await Promise.all([
        raw.user.findMany({ where: { id: { in: [userId, otherId] } } }), raw.healthMember.findMany({ where: { userId } }), raw.healthMeasurement.findMany({ where: { userId } }), raw.healthMedication.findMany({ where: { userId } }), raw.healthDocument.findMany({ where: { userId } }), raw.wealthRecord.findMany({ where: { ownerUserId: userId } }), raw.document.findMany({ where: { ownerProfileId: userId } }), raw.temporaryUpload.findMany({ where: { ownerProfileId: userId } }),
      ])) assert(!JSON.stringify(rows).includes(marker));
      const storedMeasurement = await raw.healthMeasurement.findFirstOrThrow({ where: { userId } }); assert.equal(storedMeasurement.value, 0); assert.equal(storedMeasurement.measuredAt.getTime(), 0);
      await assert.rejects(raw.healthMember.update({ where: { id: member.id }, data: { name: marker } }));
      const projection = operationalProjection("HealthMember", updated as unknown as Record<string, unknown>); assert(!JSON.stringify(projection).includes(marker)); assert(!("name" in projection)); assert(!Object.keys(projection).some(key => key.startsWith("private_")));
      stage = "live-ai";
      if (process.argv.includes("--live-ai")) {
        await prisma.user.update({ where: { id: userId }, data: { aiProcessingEnabled: true } });
        const { assertAIProcessingEnabled } = await import("../services/aiProcessing.service");
        await assertAIProcessingEnabled(userId);
        const { OpenAIDocumentAnalyzer } = await import("../services/documentAnalyzer/openaiDocumentAnalyzer");
        const { withIsolatedPlaintextFile } = await import("../services/documentSecurityValidation");
        await withIsolatedPlaintextFile(bytes, ".pdf", async file => {
          const result = await new OpenAIDocumentAnalyzer().analyzeDocument([{ path: file, originalName: "synthetic.pdf", mimeType: "application/pdf", size: bytes.length }]);
          assert(result.extractedText && /103/.test(result.extractedText));
        });
      }
      stage = "services";
      const { storedBytes } = await import("../services/accountUsage.service");
      assert.equal(await storedBytes(userId), stored.encryptedSize);
      const preview = await storage.readDecryptedDocumentFile(storedKey!, stored); assert(preview.equals(bytes)); preview.fill(0);
      await health.createManualReminder(userId, { memberId: member.id, title: marker, type: "appointment", dueDate: "2030-01-11", frequency: "once" });
      const trust = await import("../services/trustCenter.service");
      const family = await trust.addFamilyMember(userId, { name: marker, email: `family-${userId}@example.test`, relation: "PARENT", dateOfBirth: "1960-01-11", bloodGroup: "O+", accessTypeCode: "FAMILY_MEMBER", permissions: [{ module: "WEALTH", canView: true, canDownload: false }] });
      const handoff = await import("../services/wealthHandoff.service");
      assert.equal((await handoff.getWealthHandoffSummary(userId)).recipients.family.find(item => item.id === family.id)?.canReceiveHandoff, false);
      await assert.rejects(handoff.sendWealthHandoff(userId, { familyRecipientIds: [family.id], emergencyRecipientIds: [] }));
      const packs = await import("../services/packs.service");
      const pack = await packs.createCustomPack(userId, { title: marker, requirements: [marker] }); assert(pack);
      const search = await import("../services/globalSearchSources.service");
      assert((await search.searchPackages(userId, marker, 10)).length > 0);
      assert((await search.searchHealth(userId, marker, 10)).length > 0);
      assert((await search.searchWealth(userId, marker, 10)).length > 0);
      const admin = await import("../services/adminPackages.service");
      assert(!JSON.stringify(await admin.listAdminPackages({ limit: 100, page: 1 })).includes(marker));
      stage = "export";
      const exports = await import("../services/accountExport.service");
      const job = await prisma.accountExportJob.create({ data: { userId, status: "REQUESTED" } });
      await exports.prepareAccountExport(job.id);
      const ready = await exports.getAccountExportJob(userId, job.id); assert.equal(ready.status, "READY"); assert.equal(ready.archiveEncryptionVersion, 2); assert(ready.storageKey); exportKeys.push(ready.storageKey);
      const encryptedExport = await getStorageProvider().download(ready.storageKey); assert(!encryptedExport.includes(Buffer.from(marker))); assert(encryptedExport.toString().startsWith("enc:v2:")); encryptedExport.fill(0);
      const archive = await exports.downloadAccountExport(userId, job.id); assert.equal(archive.data.subarray(0, 2).toString(), "PK"); assert(archive.data.includes(Buffer.from(marker))); archive.data.fill(0);
      await withPrivateUser(otherId, () => assert.rejects(exports.downloadAccountExport(otherId, job.id), /not found/i));
      for (const rows of await Promise.all([raw.readinessPack.findMany({ where: { createdBy: userId } }), raw.trustMember.findMany({ where: { ownerUserId: userId } })])) assert(!JSON.stringify(rows).includes(marker));
      bytes.fill(0);
    });
    await withPrivateUser(otherId, () => assert.rejects(health.updateHealthMember(otherId, memberId, { name: marker }), /not found/i));
    stage = "http";
    const { signAccessToken } = await import("../utils/jwt");
    const deployedBase = process.env.PRIVACY_SMOKE_API_URL;
    if (deployedBase && !/^https:\/\/backend-[a-z0-9]+-lifepack1\.vercel\.app$/.test(deployedBase)) throw new Error("VERIFIED_DEPLOYMENT_URL_REQUIRED");
    const server = deployedBase ? null : (await import("../app")).app.listen(0, "127.0.0.1");
    if (server) await once(server, "listening");
    const probe = process.env.PRIVACY_SMOKE_PROBE;
    if (deployedBase && !probe) throw new Error("MAINTENANCE_PROBE_REQUIRED");
    const request = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), ...(probe ? { "x-readiness-rollout-probe": probe } : {}) }, signal: AbortSignal.timeout(90000) });
    try {
      const base = deployedBase || `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
      const loginResponse = await request(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${userId}@example.test`, password }) });
      assert.equal(loginResponse.status, 200); const loginCookie = loginResponse.headers.get("set-cookie")!; assert.match(loginCookie, /HttpOnly/);
      const refreshCookie = loginCookie.match(/readiness_refresh=([^;]+)/)?.[1]; assert(refreshCookie);
      const refreshed = await request(`${base}/auth/refresh`, { method: "POST", headers: { Cookie: `readiness_refresh=${refreshCookie}` } }); assert.equal(refreshed.status, 200);
      for (const provider of ["gmail", "drive"]) assert.equal((await request(`${base}/api/integrations/${provider}/status`)).status, 404);
      stage = "deployed-writes";
      const authorization = { Authorization: `Bearer ${signAccessToken({ sub: userId, authVersion: 0 })}` };
      const createdResponse = await request(`${base}/api/health/members`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: `${marker}-http`, relation: "Child" }) });
      assert.equal(createdResponse.status, 201); const created = await createdResponse.json() as { id: string };
      assert(!JSON.stringify(await raw.healthMember.findUniqueOrThrow({ where: { id: created.id } })).includes(marker));
      const updatedResponse = await request(`${base}/api/health/members/${created.id}`, { method: "PATCH", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: `${marker}-http-updated` }) }); assert.equal(updatedResponse.status, 200);
      assert(!JSON.stringify(await raw.healthMember.findUniqueOrThrow({ where: { id: created.id } })).includes(marker));
      const denied = await request(`${base}/api/health/members/${memberId}/overview`, { headers: { Authorization: `Bearer ${signAccessToken({ sub: otherId, authVersion: 0 })}` } }); assert.equal(denied.status, 404);
      assert.equal((await request(`${base}/api/admin/packages`, { headers: authorization })).status, 403);
      const ownerPaths = ["/api/search?q=" + encodeURIComponent(marker), "/api/wealth/records", "/api/trust", "/api/health/home-attention", "/documents", "/packs"];
      for (const route of ownerPaths) { const response = await request(base + route, { headers: authorization }); assert.equal(response.status, 200); }
      const document = await raw.document.findFirstOrThrow({ where: { ownerProfileId: userId }, select: { id: true } });
      for (const suffix of ["preview", "download"]) { const response = await request(`${base}/documents/${document.id}/${suffix}`, { headers: authorization }); assert.equal(response.status, 200); assert(Buffer.from(await response.arrayBuffer()).subarray(0, 4).equals(Buffer.from("%PDF"))); }
      const job = await raw.accountExportJob.findFirstOrThrow({ where: { userId }, select: { id: true } });
      const archiveResponse = await request(`${base}/api/account/export/${job.id}/download`, { headers: authorization }); assert.equal(archiveResponse.status, 200); assert.equal(Buffer.from(await archiveResponse.arrayBuffer()).subarray(0, 2).toString(), "PK");
      for (const id of [userId, otherId]) {
        const response = await request(`${base}/api/health/members`, { headers: { Authorization: `Bearer ${signAccessToken({ sub: id, authVersion: 0 })}` } }); assert.equal(response.status, 200);
        const body = await response.text(); assert.equal(body.includes(`${marker}-updated`), id === userId); assert.match(response.headers.get("cache-control")!, /no-store/);
      }
    } finally { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    console.log(JSON.stringify({ deployedHttp: !!deployedBase, productionDatabase: true, serviceCreateUpdateEncrypted: true, rawPlaintextRejected: true, manualEntryAiDisabled: true, originalFileHealthAI: true, failedRetryPreservesData: true, crossUserDenied: true, operatorProjectionRedacted: true, authenticatedHttp: true, futureGoogleRoutesDisabled: true, liveSyntheticAI: process.argv.includes("--live-ai"), loginRefresh: true, reminders: true, familyPermissions: true, packagesSearch: true, encryptedExport: true, previewAndUsage: true }));
  } finally {
    const failedStage = stage; stage = "cleanup";
    extraction.setHealthExtractionRequestForTests(null);
    for (const key of exportKeys) await getStorageProvider().delete(key);
    if (storedKey) await storage.removePermanentFile(storedKey);
    if (tempPath) await storage.deleteTemporaryUploadFile({ storagePath: tempPath });
    await raw.temporaryUpload.deleteMany({ where: { ownerProfileId: { in: [userId, otherId] } } });
    await raw.document.deleteMany({ where: { ownerProfileId: { in: [userId, otherId] } } });
    await raw.readinessPack.deleteMany({ where: { createdBy: { in: [userId, otherId] } } });
    await raw.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    assert.deepEqual(await counts(), before);
    console.log(JSON.stringify({ syntheticFixturesRemoved: true, allTableCountsUnchanged: true }));
    email.setEmailProviderForTests(null);
    await prisma.$disconnect(); stage = failedStage;
  }
}
run().then(() => { process.exitCode = 42; }).catch(() => { console.error(JSON.stringify({ productionVerificationFailed: true, stage, code: "PRODUCTION_SYNTHETIC_CHECK_FAILED" })); process.exitCode = 1; }).finally(() => raw.$disconnect());
