import { withPrivateMigration, withPrivateUser } from "./access";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { encryptJobPatch, decryptPackageJob } from "./packageJob";

// This test intentionally exercises DDL and legacy writes. It is restricted to
// the disposable database documented in the runbook, never DATABASE_URL alone.
const testUrl = process.env.PRIVACY_TEST_DATABASE_URL;
if (!testUrl || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/privacy_test(?:\?|$)/.test(testUrl)) {
  throw new Error("Use the isolated local privacy_test container on port 55439.");
}
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;
process.env.PRIVATE_DATA_KEYRING_JSON = JSON.stringify({ localtest: `base64:${randomBytes(32).toString("base64")}` });
process.env.PRIVATE_DATA_ACTIVE_KEY_ID = "localtest";
process.env.PRIVATE_DATA_LOOKUP_KEY = `base64:${randomBytes(32).toString("base64")}`;
process.env.STORAGE_DRIVER = "local";
const sample = `PRIVATE-SAMPLE-${randomUUID()}-melanoma-23456`;
const raw = new PrismaClient({ log: [] });

async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "privacy-at-rest-"));
  process.env.LOCAL_STORAGE_PATH = directory;
  const { prisma } = await import("../lib/prisma");
  const { createCustomPackageGenerationJob, getAndMaybeProcessCustomPackageGenerationJob } = await import("../services/customPackageGenerationQueue.service");
  const { downloadAccountExport, prepareAccountExport } = await import("../services/accountExport.service");
  const { listAdminPackages, getAdminPackage } = await import("../services/adminPackages.service");
  const userId = randomUUID(), otherUserId = randomUUID(), legacyId = randomUUID();
  const aiPackId = randomUUID();
  try {
    await raw.$executeRawUnsafe('ALTER TABLE "CustomPackageGenerationJob" DROP CONSTRAINT IF EXISTS "private_job_ciphertext_v2"');
    await withPrivateMigration("synthetic user fixtures", () => prisma.user.createMany({ data: [{ id: userId, name: sample, email: `${userId}@example.test` }, { id: otherUserId, name: "Other", email: `${otherUserId}@example.test` }] }));
    await raw.customPackageGenerationJob.create({ data: { id: legacyId, userId, dedupeKey: "legacy", packageType: sample, documentLabels: [sample], draft: { title: sample }, statusMessage: sample, errorMessage: sample, confidence: "high", disclaimer: sample, status: "completed" } });
    const oldExportId = randomUUID();
    const oldKey = `${userId}/exports/${oldExportId}/readiness-export.zip`;
    const oldZip = Buffer.from(`PK\u0003\u0004${sample}`);
    await fs.mkdir(path.dirname(path.join(directory, oldKey)), { recursive: true });
    await fs.writeFile(path.join(directory, oldKey), oldZip);
    await withPrivateUser(userId, () => prisma.accountExportJob.create({ data: { id: oldExportId, userId, storageKey: oldKey, fileName: "readiness-export.zip", status: "READY", expiresAt: new Date(Date.now() + 60_000) } }));
    // Exercise the complete expansion migration, not a reconstructed constraint.
    await raw.$executeRawUnsafe('ALTER TABLE "account_export_jobs" DROP COLUMN "archiveEncryptionVersion"');
    const migration = await fs.readFile(path.resolve("prisma/migrations/20261015190000_private_jobs_and_exports/migration.sql"), "utf8");
    for (const statement of migration.split(";").filter(value => value.trim())) await raw.$executeRawUnsafe(statement);

    function migrate(...args: string[]) {
      const stdout = execFileSync(process.execPath, ["--import", "tsx", "src/scripts/migratePrivateJobsAndExports.ts", ...args], { env: process.env, encoding: "utf8" });
      assert(!stdout.includes(sample));
      return JSON.parse(stdout.trim());
    }
    const dry = migrate();
    assert.equal(dry.jobsPending, 1);
    assert.equal(dry.exportsPending, 1);
    assert.equal((await raw.customPackageGenerationJob.findUniqueOrThrow({ where: { id: legacyId } })).packageType, sample);
    const applied = migrate("--apply");
    assert.equal(applied.jobsUpdated, 1);
    assert.equal(applied.exportsUpdated, 1);
    assert.equal(applied.cleanupPending, 0);
    const verified = migrate("--verify");
    assert.equal(verified.jobsPending + verified.exportsPending + verified.cleanupPending, 0);
    assert.equal(migrate("--apply").jobsUpdated, 0);
    await raw.$executeRawUnsafe('ALTER TABLE "CustomPackageGenerationJob" VALIDATE CONSTRAINT "private_job_ciphertext_v2"');
    const stored = await raw.customPackageGenerationJob.findUniqueOrThrow({ where: { id: legacyId } });
    assert(!JSON.stringify(stored).includes(sample));
    assert.equal(decryptPackageJob(stored, userId).packageType, sample);
    assert.throws(() => decryptPackageJob(stored, otherUserId));
    const migratedExport = await raw.accountExportJob.findUniqueOrThrow({ where: { id: oldExportId } });
    assert(!(await fs.readFile(path.join(directory, migratedExport.storageKey!))).includes(Buffer.from(sample)));
    await assert.rejects(fs.access(path.join(directory, oldKey)));
    assert.deepEqual((await withPrivateUser(userId, () => downloadAccountExport(userId, oldExportId))).data, oldZip);
    await assert.rejects(downloadAccountExport(otherUserId, oldExportId), /not found/);
    await assert.rejects(raw.customPackageGenerationJob.update({ where: { id: legacyId }, data: { packageType: sample } }));
    await assert.rejects(raw.customPackageGenerationJob.updateMany({ data: { documentLabels: [sample] } }));
    await assert.rejects(raw.user.update({ where: { id: userId }, data: { customPackageGenerationJobs: { create: { packageType: sample, documentLabels: [sample], dedupeKey: "bad" } } } }));
    await assert.rejects(prisma.customPackageGenerationJob.update({ where: { id: legacyId }, data: { draft: { sample } } }), /PLAINTEXT_WRITE_REJECTED/);
    // Guard remains active inside interactive transactions.
    await assert.rejects(prisma.$transaction(tx => tx.customPackageGenerationJob.update({ where: { id: legacyId }, data: { packageType: sample } })), /PLAINTEXT_WRITE_REJECTED/);
    const created = await createCustomPackageGenerationJob(userId, { packageType: "Sampleprivate melanoma appointment", documentLabels: ["Medical record"] });
    const duplicate = await createCustomPackageGenerationJob(userId, { packageType: "Sampleprivate melanoma appointment", documentLabels: ["Medical record"] });
    assert.equal(created.id, duplicate.id);
    const actualStored = await raw.customPackageGenerationJob.findUniqueOrThrow({ where: { id: created.id } });
    assert(!JSON.stringify(actualStored).includes("Sampleprivate melanoma"));
    await raw.customPackageGenerationJob.update({ where: { id: created.id }, data: encryptJobPatch(actualStored, { status: "completed", draft: { packageName: sample } }) });
    assert.equal(await getAndMaybeProcessCustomPackageGenerationJob(otherUserId, created.id), null);
    assert.equal((await getAndMaybeProcessCustomPackageGenerationJob(userId, created.id))?.draft?.packageName, sample);

    const exportJob = await withPrivateUser(userId, () => prisma.accountExportJob.create({ data: { userId } }));
    await prepareAccountExport(exportJob.id);
    const ready = await raw.accountExportJob.findUniqueOrThrow({ where: { id: exportJob.id } });
    assert.equal(ready.status, "READY");
    assert.equal(ready.archiveEncryptionVersion, 2);
    const archive = await fs.readFile(path.join(directory, ready.storageKey!));
    assert(!archive.includes(Buffer.from(sample)));
    const downloaded = await withPrivateUser(userId, () => downloadAccountExport(userId, exportJob.id));
    assert(downloaded.data.includes(Buffer.from(sample)));
    await assert.rejects(downloadAccountExport(otherUserId, exportJob.id), /not found/);
    await withPrivateMigration("synthetic legacy AI fixture", () => prisma.readinessPack.create({ data: { id: aiPackId, slug: aiPackId, title: sample, category: "Other", aliases: [sample], keywords: [], description: sample, createdBy: "ai" } }));
    assert.equal(await getAdminPackage(aiPackId), null);
    assert(!(await listAdminPackages({ page: 1, limit: 100 })).items.some(item => item.id === aiPackId));
    console.log("PASS: real PostgreSQL dry-run/apply/verify/retry, ciphertext inspection, SQL/nested/bulk/transaction write rejection, job dedupe/ownership, export generation/download/isolation/cleanup, admin AI redaction.");
  } finally {
    await raw.readinessPack.deleteMany({ where: { id: aiPackId } });
    await raw.customPackageGenerationJob.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await raw.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await Promise.all([raw.$disconnect(), prisma.$disconnect()]);
    await fs.rm(directory, { recursive: true, force: true });
  }
}
run().catch(error => { console.error("Privacy integration test failed.", { name: error.name, code: error.code, frames: String(error.stack).split("\n").filter((line: string) => /^\s+at /.test(line)).slice(-5) }); process.exitCode = 1; });
