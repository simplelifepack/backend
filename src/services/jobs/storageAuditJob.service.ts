import { prisma } from "../../lib/prisma";
import { getStorageProvider } from "../../infrastructure/storage/createStorageProvider";
import { writeAuditLog } from "../adminAudit.service";
import { JobError } from "./jobError";

const DEFAULT_BATCH_SIZE = 25; // smaller than rewrap's — each document can mean several storage round-trips (one per page file)

type Finding = { documentId: string; label: string; storageKey: string | null; error?: string };

/** Unlike `key_rewrap`, auditing a document never changes it, so the
 * candidate set (all non-deleted documents) doesn't shrink as a tick
 * processes it — this job type needs a real cursor, paginated by id. */
async function nextBatch(cursor: string | null, batchSize: number) {
  return prisma.document.findMany({
    where: { deletedAt: null },
    select: {
      id: true, storageKey: true, path: true,
      files: { select: { id: true, pageIndex: true, storageKey: true }, orderBy: { pageIndex: "asc" } },
    },
    orderBy: { id: "asc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: batchSize,
  });
}

async function checkLocation(label: string, documentId: string, storageKey: string | null): Promise<Finding | null> {
  if (!storageKey) return { documentId, label, storageKey: null, error: "No storage key recorded." };
  try {
    const found = await getStorageProvider().exists(storageKey);
    return found ? null : { documentId, label, storageKey };
  } catch (error) {
    return { documentId, label, storageKey, error: error instanceof Error ? error.message : "Storage check failed." };
  }
}

export async function previewStorageAudit() {
  const totalCount = await prisma.document.count({ where: { deletedAt: null } });
  return { totalCount };
}

export async function getRunningStorageAuditJob() {
  return prisma.job.findFirst({
    where: { type: "storage_audit", status: { in: ["running", "paused"] } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listStorageAuditJobs() {
  return prisma.job.findMany({ where: { type: "storage_audit" }, orderBy: { createdAt: "desc" }, take: 20 });
}

type AdminCtx = { adminId: string; actorEmail: string };

export async function startStorageAuditJob(ctx: AdminCtx, batchSize = DEFAULT_BATCH_SIZE) {
  const existing = await getRunningStorageAuditJob();
  if (existing) throw new JobError("A storage audit is already running or paused. Resume or let it finish first.", 409);

  const totalCount = await prisma.document.count({ where: { deletedAt: null } });

  return prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        type: "storage_audit", status: "running", totalCount,
        params: { batchSize }, resultSummary: { findings: [] },
        startedByAdminId: ctx.adminId, approvedByAdminId: ctx.adminId,
      },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "job.storage_audit.start",
      targetType: "Job", targetId: job.id, diff: { totalCount },
    });
    return job;
  });
}

/** Advances one batch. Auditing is read-only and every document's check is
 * independent — unlike `key_rewrap` there is no fail-fast here: a missing
 * object or an unreachable storage provider for one document is exactly the
 * kind of thing this job exists to surface, not a reason to stop auditing
 * the rest. The job always reaches "completed" once the cursor exhausts the
 * table; findings accumulate in `resultSummary` for a human to act on
 * (recovery itself stays a CLI-only action — see the tracker note). */
export async function tickStorageAuditJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobError("Job not found.", 404);
  if (job.type !== "storage_audit") throw new JobError("Not a storage audit job.", 400);
  if (job.status === "completed" || job.status === "failed") return job;
  if (job.status === "paused") throw new JobError("Job is paused. Resume it first.", 409);

  const batchSize = (job.params as { batchSize?: number } | null)?.batchSize ?? DEFAULT_BATCH_SIZE;
  const batch = await nextBatch(job.cursor, batchSize);

  if (batch.length === 0) {
    const completed = await prisma.job.update({
      where: { id: jobId },
      data: { status: "completed", completedAt: new Date() },
    });
    await writeAuditLog(prisma, {
      adminId: job.startedByAdminId, actorEmail: "system", action: "job.storage_audit.complete",
      targetType: "Job", targetId: jobId,
      diff: { processedCount: completed.processedCount, missingCount: completed.updatedCount },
    });
    return completed;
  }

  const findings: Finding[] = [];
  for (const doc of batch) {
    const locations: [string, string | null][] = [
      ["document", doc.storageKey ?? doc.path],
      ...doc.files.map((f): [string, string | null] => [`page:${f.pageIndex}`, f.storageKey]),
    ];
    for (const [label, key] of locations) {
      const finding = await checkLocation(label, doc.id, key);
      if (finding) findings.push(finding);
    }
  }

  const existingFindings = ((job.resultSummary as { findings?: Finding[] } | null)?.findings) ?? [];
  const nextCursor = batch[batch.length - 1]!.id;

  return prisma.job.update({
    where: { id: jobId },
    data: {
      cursor: nextCursor,
      processedCount: { increment: batch.length },
      updatedCount: { increment: findings.length }, // repurposed: count of storage issues found so far, not a mutation count
      // No cap: this is the whole point of the job — truncating findings would
      // mean silently hiding which documents are actually broken. At this
      // product's realistic document counts (thousands, not millions) a jsonb
      // array of flagged ids is trivial for Postgres.
      resultSummary: { findings: [...existingFindings, ...findings] },
    },
  });
}

export async function pauseStorageAuditJob(ctx: AdminCtx, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobError("Job not found.", 404);
  if (job.status !== "running") throw new JobError("Only a running job can be paused.", 409);
  await writeAuditLog(prisma, { adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "job.storage_audit.pause", targetType: "Job", targetId: jobId });
  return prisma.job.update({ where: { id: jobId }, data: { status: "paused" } });
}

export async function resumeStorageAuditJob(ctx: AdminCtx, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobError("Job not found.", 404);
  if (job.status !== "paused") throw new JobError("Only a paused job can be resumed.", 409);
  await writeAuditLog(prisma, { adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "job.storage_audit.resume", targetType: "Job", targetId: jobId });
  return prisma.job.update({ where: { id: jobId }, data: { status: "running" } });
}
