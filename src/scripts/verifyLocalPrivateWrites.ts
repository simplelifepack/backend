import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { configureNormalLocalBackend } from "./localBackendEnvironment";
import { withPrivateMigration, withPrivateUser } from "../privacy/access";
import { operationalProjection } from "../privacy/operationalFields";

// Synthetic-only service smoke check. Never alters constraints or existing rows.
// Requires the migrated normal local database, its original keys and storage.
const position = process.argv.indexOf("--env-file");
configureNormalLocalBackend(position >= 0 ? process.argv[position + 1] : undefined);
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
async function run() {
  const { prisma } = await import("../lib/prisma");
  const health = await import("../services/health.service");
  const wealth = await import("../services/wealthRecords.service");
  const extraction = await import("../services/healthExtraction.service");
  const storage = await import("../services/documentFileStorage");
  const { encryptDocumentOnBackend } = await import("../services/documentHybridEncryption");
  const { getStorageProvider } = await import("../infrastructure/storage/createStorageProvider");
  const before = await counts();
  let storedKey: string | undefined, tempPath: string | undefined;
  try {
    await withPrivateMigration("synthetic local verification users only", () => prisma.user.createMany({ data: [userId, otherId].map(id => ({ id, email: `${id}@example.test`, name: marker, aiProcessingEnabled: false })) }));
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
      if (process.argv.includes("--live-ai")) {
        const { OpenAIDocumentAnalyzer } = await import("../services/documentAnalyzer/openaiDocumentAnalyzer");
        const { withIsolatedPlaintextFile } = await import("../services/documentSecurityValidation");
        await withIsolatedPlaintextFile(bytes, ".pdf", async file => {
          const result = await new OpenAIDocumentAnalyzer().analyzeDocument([{ path: file, originalName: "synthetic.pdf", mimeType: "application/pdf", size: bytes.length }]);
          assert(result.extractedText && /103/.test(result.extractedText));
        });
      }
      bytes.fill(0);
    });
    await withPrivateUser(otherId, () => assert.rejects(health.updateHealthMember(otherId, memberId, { name: marker }), /not found/i));
    const { app } = await import("../app"); const { signAccessToken } = await import("../utils/jwt");
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const provider of ["gmail", "drive"]) assert.equal((await fetch(`${base}/api/integrations/${provider}/status`)).status, 404);
      for (const id of [userId, otherId]) {
        const response = await fetch(`${base}/api/health/members`, { headers: { Authorization: `Bearer ${signAccessToken({ sub: id, authVersion: 0 })}` } }); assert.equal(response.status, 200);
        const body = await response.text(); assert.equal(body.includes(`${marker}-updated`), id === userId); assert.match(response.headers.get("cache-control")!, /no-store/);
      }
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    console.log(JSON.stringify({ normalLocalDatabase: true, serviceCreateUpdateEncrypted: true, rawPlaintextRejected: true, manualEntryAiDisabled: true, originalFileHealthAI: true, failedRetryPreservesData: true, crossUserDenied: true, operatorProjectionRedacted: true, authenticatedHttp: true, futureGoogleRoutesDisabled: true, liveSyntheticAI: process.argv.includes("--live-ai") }));
  } finally {
    extraction.setHealthExtractionRequestForTests(null);
    if (storedKey) await storage.removePermanentFile(storedKey);
    if (tempPath) await storage.deleteTemporaryUploadFile({ storagePath: tempPath });
    await raw.temporaryUpload.deleteMany({ where: { ownerProfileId: { in: [userId, otherId] } } });
    await raw.document.deleteMany({ where: { ownerProfileId: { in: [userId, otherId] } } });
    await raw.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    assert.deepEqual(await counts(), before);
    console.log(JSON.stringify({ syntheticFixturesRemoved: true, allTableCountsUnchanged: true }));
    await prisma.$disconnect();
  }
}
run().catch(error => { console.error(JSON.stringify({ localVerificationFailed: true, errorType: error.name, code: error.code ?? null, frames: String(error.stack).split("\n").filter((line: string) => /^\s+at /.test(line)).slice(0, 3) })); process.exitCode = 1; }).finally(() => raw.$disconnect());
