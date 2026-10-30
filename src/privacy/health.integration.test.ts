/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { withPrivateUser, withPrivateMigration } from "./access";
import { encryptedModels, modelDefinitions } from "./modelCodec";

const testUrl = process.env.PRIVACY_TEST_DATABASE_URL;
if (!testUrl || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/privacy_test(?:\?|$)/.test(testUrl)) throw new Error("Use isolated local privacy_test on port 55439.");
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;
process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ localhealth: `base64:${randomBytes(32).toString("base64")}` });
process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "localhealth";
process.env.PRIVATE_DATA_LOOKUP_KEY = `base64:${randomBytes(32).toString("base64")}`;
const raw = new PrismaClient({ log: [] });
const userId = randomUUID(), anotherUserId = randomUUID(), sample = `SECRET-HEALTH-${randomUUID()}`;

async function run() {
  const { prisma } = await import("../lib/prisma");
  const health = await import("../services/health.service");
  const { getHealthHomeAttention } = await import("../services/healthHome.service");
  const { searchHealth } = await import("../services/globalSearchSources.service");
  const statements = (await fs.readFile("prisma/migrations/20261015200000_private_health_fields/migration.sql", "utf8")).replace(/^\s*--.*$/gm, "").split(";").filter(item => item.trim());
  const hasColumns = await raw.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='health_members' AND column_name='private_name') AS present`;
  if (!hasColumns[0].present) for (const statement of statements.filter(item => !item.includes("ADD CONSTRAINT"))) await raw.$executeRawUnsafe(statement);
  for (const model of [...encryptedModels].filter(name => name.startsWith("Health") || name === "TrackedHealthMetric")) {
    const table = modelDefinitions.get(model)!.dbName!;
    await raw.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${table}_private_v2"`);
  }
  const outcomeConstraint = await raw.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='health_document_outcome_private_v2') AS present`;
  if (!outcomeConstraint[0].present) {
    const outcome = await fs.readFile("prisma/migrations/20261016120000_private_health_extraction_outcomes/migration.sql", "utf8");
    for (const statement of outcome.split(";").filter(value => value.includes("ADD CONSTRAINT"))) await raw.$executeRawUnsafe(statement);
  }
  try {
    await withPrivateMigration("synthetic user fixtures", () => prisma.user.createMany({ data: [{ id: userId, email: `${userId}@example.test`, name: "Owner", aiProcessingEnabled: false }, { id: anotherUserId, email: `${anotherUserId}@example.test`, name: "Other", aiProcessingEnabled: false }] }));
    const legacy = await raw.healthMember.create({ data: { userId, name: sample, relation: "Myself", bloodGroup: "A+", dateOfBirth: new Date("1988-03-14"), conditions: sample } });
    const oldReading = await raw.healthMeasurement.create({ data: { userId, memberId: legacy.id, metricKey: "blood_glucose", displayName: sample, originalName: sample, value: 143.284019, unit: "mg/dL", measuredAt: new Date("2026-01-11") } });
    for (const statement of statements.filter(item => item.includes("ADD CONSTRAINT"))) await raw.$executeRawUnsafe(statement);
    const migrate = (...args: string[]) => {
      const output = execFileSync(process.execPath, ["--import", "tsx", "src/scripts/migratePrivateRecords.ts", "--models=health", ...args], { env: process.env, encoding: "utf8" });
      assert(!output.includes(sample));
      return JSON.parse(output.trim());
    };
    assert.equal(migrate().models.HealthMember.pending, 1);
    assert.equal(migrate("--apply").models.HealthMeasurement.updated, 1);
    assert.equal(migrate("--verify").models.HealthMeasurement.pending, 0);
    assert.equal(migrate("--apply").models.HealthMember.updated, 0);
    const rawLegacy = await raw.healthMember.findUniqueOrThrow({ where: { id: legacy.id } });
    assert(!JSON.stringify(rawLegacy).includes(sample));
    const rawReading = await raw.healthMeasurement.findUniqueOrThrow({ where: { id: oldReading.id } });
    assert.equal(rawReading.value, 0);
    assert.equal(rawReading.measuredAt.getTime(), 0);
    assert(!JSON.stringify(rawReading).includes("143.284019"));
    await assert.rejects(prisma.healthMember.findUnique({ where: { id: legacy.id } }), /not found/);
    await withPrivateUser(userId, async () => {
      assert.equal((await prisma.healthMember.findUniqueOrThrow({ where: { id: legacy.id } })).name, sample);
      const member = await health.createHealthMember(userId, { name: `${sample}-member`, relation: "Child", dateOfBirth: "2011-07-11", allergies: sample, conditions: sample });
      const memberId = member.id;
      const first = await health.createManualMeasurement(userId, memberId, { metricKey: "blood_glucose", displayName: sample, originalName: sample, value: 101.15, unit: "mg/dL", measuredAt: "2026-01-02", referenceMin: 70, referenceMax: 100 });
      await health.createManualMeasurement(userId, memberId, { metricKey: "blood_glucose", displayName: sample, value: 99.75, unit: "mg/dL", measuredAt: "2026-01-01" });
      const readings = await health.listMeasurements(userId, memberId, { metric: "blood_glucose" });
      assert.equal(readings.length, 2);
      assert.equal(readings[0].value, 99.75);
      assert.equal(readings[1].value, 101.15);
      assert.equal((await prisma.healthMeasurement.findMany({ where: { userId, memberId, value: { gt: 100 } } })).length, 1);
      assert.equal((await prisma.healthMeasurement.findMany({ where: { userId, memberId, NOT: { value: { gt: 100 } } } })).length, 1);
      assert.equal((await prisma.healthMeasurement.findMany({ where: { userId, memberId }, select: { value: true }, orderBy: { value: "desc" }, take: 1 }))[0].value, 101.15);
      assert(!Object.keys(await prisma.healthMeasurement.findUniqueOrThrow({ where: { id: first.id } })).some(key => key.startsWith("private_")));
      const tracked = await health.enableTrackedMetric(userId, memberId, { metricKey: "blood_glucose", displayName: sample });
      assert.equal((await health.listTrackedMetrics(userId, memberId)).length, 1);
      await health.disableTrackedMetric(userId, memberId, tracked.id);
      assert.equal((await health.listTrackedMetrics(userId, memberId)).length, 0);
      const date = new Date(); date.setDate(date.getDate() + 2);
      const medicine = await health.createManualMedication(userId, memberId, { name: `${sample}-medicine`, dose: "10 mg", whenToTake: ["morning"], mealTiming: "after_food", repeatRunsOut: date.toISOString().slice(0, 10) });
      assert.equal(medicine.name, `${sample}-medicine`);
      assert.deepEqual(medicine.whenToTake, ["morning"]);
      assert((await getHealthHomeAttention(userId)).medications.some(item => item.id === medicine.id));
      await health.updateMedication(userId, medicine.id, { status: "stopped", stoppedAt: "2026-02-11" });
      assert(!(await getHealthHomeAttention(userId)).medications.some(item => item.id === medicine.id));
      const reminder = await health.createManualReminder(userId, { memberId, title: sample, type: "appointment", dueDate: date.toISOString().slice(0, 10), frequency: "once" });
      assert((await health.listActiveHealthReminders(userId)).some(item => item.id === reminder.id));
      assert((await searchHealth(userId, sample, 20)).some(item => item.id === memberId));
      const doc = await prisma.document.create({ data: { ownerProfileId: userId, originalName: "fixture.pdf", storedName: "opaque", mimeType: "application/pdf", size: 10, path: "opaque", documentType: "medical", category: "medical", analysisSource: "manual", confidence: 100, fields: {} } });
      await prisma.$transaction(async tx => {
        const record = await tx.healthDocument.create({ data: { userId, memberId, documentId: doc.id, processingStatus: "no_medications_detected", type: "lab_report", patientName: sample, patientDateOfBirth: new Date("2011-07-11"), pendingExtraction: { patient: { name: sample }, measurements: [{ value: 143.284019 }] } } });
        await tx.healthMeasurement.createMany({ data: [{ userId, memberId, sourceDocumentId: record.id, metricKey: "blood_glucose", displayName: sample, originalName: sample, value: 143.284019, unit: "mg/dL", measuredAt: new Date("2026-10-01") }] });
        await tx.healthMedication.createMany({ data: [{ userId, memberId, sourceDocumentId: record.id, name: sample, dose: "20 mg", duration: sample, quantity: sample }] });
        const loaded = await tx.healthDocument.findUniqueOrThrow({ where: { id: record.id }, include: { measurements: { orderBy: { value: "desc" } }, medications: true, member: { select: { name: true } } } });
        assert.equal(loaded.processingStatus, "no_medications_detected");
        const [storedOutcome] = await tx.$queryRawUnsafe<Array<{ private_processingStatus: string }>>('SELECT * FROM health_documents WHERE id = $1', record.id);
        assert(storedOutcome.private_processingStatus?.startsWith("enc:v2:"));
        assert(!JSON.stringify(storedOutcome).includes("no_medications_detected"));

        assert.equal(loaded.measurements[0].value, 143.284019);
        assert.equal(loaded.medications[0].name, sample);
        assert.equal(loaded.member!.name, `${sample}-member`);
        assert.equal((loaded.pendingExtraction as any).patient.name, sample);
        // Existing nullable compound unique indexes permit multiple null contexts.
        await tx.trackedHealthMetric.createMany({ data: [0, 1].map(() => ({ userId, memberId, metricKey: "nullable_test", displayName: sample, context: null, bodySite: null })) });
        await tx.healthDocument.update({ where: { id: record.id }, data: { pendingExtraction: Prisma.JsonNull } });
        assert.equal((await tx.healthDocument.findUniqueOrThrow({ where: { id: record.id } })).pendingExtraction, null);
      });
      const storedCopies = await Promise.all([...encryptedModels].filter(name => name.startsWith("Health") || name === "TrackedHealthMetric").map(model => (raw as any)[model[0].toLowerCase() + model.slice(1)].findMany({ where: { userId } })));
      assert(!JSON.stringify(storedCopies).includes(sample));
      await assert.rejects(raw.healthDocument.updateMany({ where: { userId }, data: { processingStatus: "handwritten_unreadable" } }));
      await assert.rejects(raw.healthMeasurement.update({ where: { id: first.id }, data: { value: 143.284019 } }));
      await assert.rejects(raw.healthMedication.updateMany({ where: { userId }, data: { name: sample } }));
      await assert.rejects(prisma.healthMember.update({ where: { id: memberId }, data: { userId: anotherUserId } }), /IMMUTABLE/);
    });
    await withPrivateUser(anotherUserId, async () => {
      await assert.rejects(prisma.healthMember.findUnique({ where: { id: legacy.id } }), /not found/);
      await assert.rejects(health.getOverview(anotherUserId, legacy.id), /not found/);
      assert.equal((await prisma.healthMeasurement.findMany({ where: { userId: anotherUserId } })).length, 0);
    });
    // Exercise AsyncLocalStorage authorization through real HTTP middleware,
    // using minimal signed JWTs and independent concurrent requests.
    const { default: healthRouter } = await import("../routes/health.routes");
    const { errorHandler } = await import("../middleware/errorHandling");
    const { signAccessToken } = await import("../utils/jwt");
    const app = express(); app.use(express.json()); app.use("/health", healthRouter); app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const token = signAccessToken({ sub: userId, authVersion: 0 });
      const otherToken = signAccessToken({ sub: anotherUserId, authVersion: 0 });
      const anonymous = await fetch(`${base}/health/members`); assert.equal(anonymous.status, 401);
      const [own, other] = await Promise.all([token, otherToken].map(accessToken => fetch(`${base}/health/members`, { headers: { Authorization: `Bearer ${accessToken}` } })));
      assert.equal(own.status, 200); assert.equal(other.status, 200);
      assert.match(own.headers.get("cache-control")!, /no-store/);
      const ownRows = await own.json(); const otherRows = await other.json();
      assert(JSON.stringify(ownRows).includes(sample)); assert(!JSON.stringify(otherRows).includes(sample));
      const forbidden = await fetch(`${base}/health/members/${legacy.id}/overview`, { headers: { Authorization: `Bearer ${otherToken}` } });
      assert.equal(forbidden.status, 404);
      assert(!(await forbidden.text()).includes(sample));
      const originalProfile = await raw.user.findUniqueOrThrow({ where: { id: userId } });
      await raw.user.update({ where: { id: userId }, data: { authVersion: 1, private_name: originalProfile.private_name!.slice(0, -4) + "AAAA" } });
      try {
        const revoked = await fetch(`${base}/health/members`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(revoked.status, 401); // Must reject before touching deliberately corrupt profile ciphertext.
      } finally { await raw.user.update({ where: { id: userId }, data: { authVersion: 0, private_name: originalProfile.private_name } }); }

    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    for (const model of [...encryptedModels].filter(name => name.startsWith("Health") || name === "TrackedHealthMetric")) {
      const table = modelDefinitions.get(model)!.dbName!;
      await raw.$executeRawUnsafe(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${table}_private_v2"`);
    }
    console.log("PASS: typed health ciphertext, counts-only resumable migration, dates/numbers/flags, manual+AI bulk paths, filters/NOT/sorting/pagination, nested projections, medications/reminders/search, raw write rejection and ownership denial.");
  } finally {
    await raw.document.deleteMany({ where: { ownerProfileId: { in: [userId, anotherUserId] } } });
    await raw.user.deleteMany({ where: { id: { in: [userId, anotherUserId] } } });
    await Promise.all([raw.$disconnect(), prisma.$disconnect()]);
  }
}
run().catch(error => {
  // Frame locations identify a failed assertion without dumping fixture values.
  console.error("Health privacy integration test failed.", { name: error.name, code: error.code, databaseCode: String(error.message).match(/code: "([0-9A-Z]{5})"/)?.[1], argument: String(error.message).match(/Unknown argument `([A-Za-z_]+)`/)?.[1], frames: String(error.stack).split("\n").filter((line: string) => /^\s+at /.test(line)).slice(-5) });
  process.exitCode = 1;
});
