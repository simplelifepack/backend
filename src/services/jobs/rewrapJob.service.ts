import { prisma } from "../../lib/prisma";
import { KEY_ALGORITHM, getActiveDocumentEncryptionKey, rewrapDocumentAesKey } from "../documentHybridEncryption";
import { writeAuditLog } from "../adminAudit.service";
import { evaluateJobFailedAlerts } from "../alerting.service";
import { JobError } from "./jobError";

export { JobError };

const DEFAULT_BATCH_SIZE = 50;

/** Candidates for `key_rewrap`: any document whose wrapped key isn't on the
 * active key id/version. Same filter `rewrapDocumentKeys.ts` uses. This set
 * *shrinks* as a chunk is processed — a rewrapped document stops matching —
 * so unlike storage_audit/backfill, key_rewrap doesn't need a real cursor:
 * "the next batch" is always just "the next N still-matching rows". */
function rewrapWhere(activeKeyId: string, activeKeyVersion: number) {
  return {
    keyAlgorithm: KEY_ALGORITHM,
    wrappedKey: { not: null },
    OR: [{ keyId: { not: activeKeyId } }, { keyVersion: { not: activeKeyVersion } }],
  };
}

export async function previewRewrap() {
  const active = getActiveDocumentEncryptionKey();
  const count = await prisma.document.count({ where: rewrapWhere(active.keyId, active.keyVersion) });
  return { activeKeyId: active.keyId, activeKeyVersion: active.keyVersion, documentsToRewrap: count };
}

export async function getRunningRewrapJob() {
  return prisma.job.findFirst({
    where: { type: "key_rewrap", status: { in: ["running", "paused"] } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listJobs(type?: "key_rewrap" | "storage_audit" | "package_source_backfill") {
  return prisma.job.findMany({
    where: type ? { type } : undefined,
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

type AdminCtx = { adminId: string; actorEmail: string };

export async function startRewrapJob(ctx: AdminCtx, batchSize = DEFAULT_BATCH_SIZE) {
  const existing = await getRunningRewrapJob();
  if (existing) throw new JobError("A rewrap job is already running or paused. Resume or let it finish first.", 409);

  const active = getActiveDocumentEncryptionKey();
  const totalCount = await prisma.document.count({ where: rewrapWhere(active.keyId, active.keyVersion) });

  // The audit entry needs the job's real id as targetId — not available
  // until the row exists, so create it first and write the audit row in the
  // same transaction, rather than `withAudit` (which builds the entry
  // before `work` runs and would log the start event with no target).
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        type: "key_rewrap", status: "running", totalCount,
        params: { batchSize, activeKeyId: active.keyId, activeKeyVersion: active.keyVersion },
        startedByAdminId: ctx.adminId, approvedByAdminId: ctx.adminId,
      },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "job.rewrap.start",
      targetType: "Job", targetId: job.id, reason: `Rewrap to ${active.keyId} v${active.keyVersion}`,
      diff: { activeKeyId: active.keyId, activeKeyVersion: active.keyVersion, totalCount },
    });
    return job;
  });
}

/** Advances one chunk. Called repeatedly — by the admin UI while the page is
 * open in local dev (no Vercel Cron attached here), and in production by a
 * scheduled Vercel Cron hitting this same endpoint (decision D5's "Vercel
 * Cron → resumable chunks") — deploy config for that cron is out of this
 * session's local-dev scope and still needs to be added. No step-up on a
 * tick: the human already approved the job once at `start`; ticks are
 * unattended mechanical continuation of already-approved work, same as a
 * cron trigger would be. */
export async function tickRewrapJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobError("Job not found.", 404);
  if (job.type !== "key_rewrap") throw new JobError("Not a rewrap job.", 400);
  if (job.status === "completed" || job.status === "failed") return job;
  if (job.status === "paused") throw new JobError("Job is paused. Resume it first.", 409);

  const active = getActiveDocumentEncryptionKey();
  const batchSize = (job.params as { batchSize?: number } | null)?.batchSize ?? DEFAULT_BATCH_SIZE;

  const batch = await prisma.document.findMany({
    where: rewrapWhere(active.keyId, active.keyVersion),
    select: { id: true, keyId: true, keyVersion: true, wrappedKey: true },
    take: batchSize,
  });

  if (batch.length === 0) {
    const completed = await prisma.job.update({
      where: { id: jobId },
      data: { status: "completed", completedAt: new Date(), resultSummary: { message: "No more documents to rewrap." } },
    });
    await writeAuditLog(prisma, {
      adminId: job.startedByAdminId, actorEmail: "system", action: "job.rewrap.complete",
      targetType: "Job", targetId: jobId, diff: { updatedCount: completed.updatedCount, processedCount: completed.processedCount },
    });
    return completed;
  }

  // Fail-fast, matching the original script: a document that fails to
  // rewrap keeps its old keyId/keyVersion, so it would still match the
  // candidate filter and get retried every tick forever if we swallowed the
  // error and kept going — a single permanently-broken document (corrupt
  // wrappedKey, etc.) would make the job never reach "completed". Stop the
  // job instead and surface it for a human to look at.
  let updated = 0;
  let processed = 0;
  for (const doc of batch) {
    processed += 1;
    if (!doc.keyId || !doc.keyVersion || !doc.wrappedKey) continue;
    try {
      const rewrapped = rewrapDocumentAesKey({ keyId: doc.keyId, keyVersion: doc.keyVersion, wrappedKey: doc.wrappedKey });
      await prisma.document.update({ where: { id: doc.id }, data: rewrapped });
      updated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rewrap failed for a document.";
      const failedJob = await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "failed",
          processedCount: { increment: processed },
          updatedCount: { increment: updated },
          failedCount: { increment: 1 },
          lastError: `Document ${doc.id}: ${message}`,
        },
      });
      await writeAuditLog(prisma, {
        adminId: job.startedByAdminId, actorEmail: "system", action: "job.rewrap.fail",
        targetType: "Job", targetId: jobId, reason: failedJob.lastError ?? undefined,
      });
      await evaluateJobFailedAlerts(failedJob);
      return failedJob;
    }
  }

  return prisma.job.update({
    where: { id: jobId },
    data: {
      processedCount: { increment: processed },
      updatedCount: { increment: updated },
    },
  });
}

export async function pauseRewrapJob(ctx: AdminCtx, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobError("Job not found.", 404);
  if (job.status !== "running") throw new JobError("Only a running job can be paused.", 409);
  await writeAuditLog(prisma, { adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "job.rewrap.pause", targetType: "Job", targetId: jobId });
  return prisma.job.update({ where: { id: jobId }, data: { status: "paused" } });
}

export async function resumeRewrapJob(ctx: AdminCtx, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobError("Job not found.", 404);
  if (job.status !== "paused") throw new JobError("Only a paused job can be resumed.", 409);
  await writeAuditLog(prisma, { adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "job.rewrap.resume", targetType: "Job", targetId: jobId });
  return prisma.job.update({ where: { id: jobId }, data: { status: "running" } });
}
