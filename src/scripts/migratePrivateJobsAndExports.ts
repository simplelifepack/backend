import "dotenv/config";
import { Prisma, type AccountExportJob } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertPrivateDataKeysConfigured, decryptPrivateBytes, encryptPrivateBytes, isPrivateCiphertext } from "../privacy/fieldEncryption";
import { decryptPackageJob } from "../privacy/packageJob";
import { migratePackageJob } from "../privacy/migratePackageJob";
import { getStorageProvider } from "../infrastructure/storage/createStorageProvider";
import { withPrivateMigration } from "../privacy/access";
import { decryptCleanupLocator, encryptedCleanupLocator } from "../privacy/storageLocator";

// Repeat from the start after interruption. Each row is its own checkpoint;
// successfully migrated fields are authenticated and left byte-for-byte intact.
async function run() {
  const apply = process.argv.includes("--apply");
  const verify = process.argv.includes("--verify");
  if (apply && verify) throw new Error("Choose apply or verify.");
  assertPrivateDataKeysConfigured();
  const counts = { jobsScanned: 0, jobsPending: 0, jobsUpdated: 0, exportsScanned: 0, exportsPending: 0, exportsUpdated: 0, cleanupPending: 0 };
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.customPackageGenerationJob.findMany({ take: 100, orderBy: { id: "asc" }, ...(cursor ? { where: { id: { gt: cursor } } } : {}) });
    if (!rows.length) break;
    for (const row of rows) {
      counts.jobsScanned++;
      const patch = migratePackageJob(row);
      if (!Object.keys(patch).length) continue;
      counts.jobsPending++;
      if (apply) {
        await prisma.$transaction(async tx => {
          // Serialize against workers and other migration invocations. Read again
          // under the lock: never replace a concurrent worker's newer result.
          await tx.$queryRaw`SELECT id FROM "CustomPackageGenerationJob" WHERE id = ${row.id} FOR UPDATE`;
          const latest = await tx.customPackageGenerationJob.findUnique({ where: { id: row.id } });
          if (!latest) return;
          const next = migratePackageJob(latest);
          if (!Object.keys(next).length) return;
          const updated = await tx.customPackageGenerationJob.update({ where: { id: row.id }, data: next as Prisma.CustomPackageGenerationJobUpdateInput });
          decryptPackageJob(updated, updated.userId); // authentication before commit
          counts.jobsUpdated++;
        });
      }
    }
    cursor = rows[rows.length - 1]!.id;
  }

  cursor = undefined;
  const storage = getStorageProvider();
  for (;;) {
    const jobs: AccountExportJob[] = await prisma.accountExportJob.findMany({ where: { storageKey: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) }, take: 20, orderBy: { id: "asc" } });
    if (!jobs.length) break;
    for (const job of jobs) {
      counts.exportsScanned++;
      const originalKey = job.storageKey!;
      const stored = await storage.download(originalKey);
      const context = { model: "AccountExportJob", recordId: job.id, ownerId: job.userId, field: "archive" };
      if (job.archiveEncryptionVersion === 2) {
        const plaintext = decryptPrivateBytes(stored.toString("utf8"), context);
        plaintext.fill(0);
        continue;
      }
      counts.exportsPending++;
      if (!apply) { stored.fill(0); continue; }
      if (isPrivateCiphertext(stored.toString("utf8"))) throw new Error("Unexpected export encryption state.");
      if (stored[0] !== 0x50 || stored[1] !== 0x4b) throw new Error("Unsupported legacy export format.");
      const newKey = `${job.userId}/exports/${job.id}/archive-v2.bin`;
      try {
        const ciphertext = encryptPrivateBytes(stored, context);
        const checked = decryptPrivateBytes(ciphertext, context);
        try { if (!checked.equals(stored)) throw new Error("Export verification failed."); }
        finally { checked.fill(0); }
        await storage.upload({ key: newKey, body: Buffer.from(ciphertext), contentType: "application/octet-stream" });
        await prisma.$transaction(async tx => {
          const changed = await tx.accountExportJob.updateMany({ where: { id: job.id, storageKey: originalKey, archiveEncryptionVersion: null }, data: { storageKey: newKey, archiveEncryptionVersion: 2 } });
          if (changed.count !== 1) throw new Error("Export changed during migration; retry.");
          const encrypted = encryptedCleanupLocator(job.userId, originalKey);
          await tx.storageCleanup.upsert({ where: { storageKey: encrypted.storageKey }, create: { ...encrypted, ownerUserId: job.userId, sizeBytes: BigInt(stored.length) }, update: {} });
        });
        counts.exportsUpdated++;
      } finally { stored.fill(0); }
    }
    cursor = jobs[jobs.length - 1]!.id;
  }
  // Only legacy export objects queued above or by an earlier interrupted run.
  const cleanup = await prisma.storageCleanup.findMany();
  for (const item of cleanup) {
    const originalKey = decryptCleanupLocator(item);
    if (!originalKey.endsWith("/readiness-export.zip") || !originalKey.includes("/exports/")) continue;
    if (!apply) { counts.cleanupPending++; continue; }
    // Recheck that no live export still references the object before deleting.
    if (await prisma.accountExportJob.count({ where: { storageKey: originalKey } })) { counts.cleanupPending++; continue; }
    try {
      await storage.delete(originalKey);
      await prisma.storageCleanup.delete({ where: { storageKey: item.storageKey } });
    } catch { counts.cleanupPending++; }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : verify ? "verify" : "dry-run", ...counts }));
  if (verify && (counts.jobsPending || counts.exportsPending || counts.cleanupPending)) process.exitCode = 1;
}

withPrivateMigration("offline job/archive encryption backfill", run).catch(() => {
  // Prisma, provider and crypto errors can include input values or object keys.
  console.error("Private jobs/exports migration failed. Check configuration and retry; completed rows are preserved.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
