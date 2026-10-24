import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../adminAudit.service";
import {
  cacheKeyForPack, findMissingSourcePackages, resolveSourceMetadata, sourceUpdateForPack,
  type PackageForBackfill, type SourceMetadata,
} from "../../scripts/backfillPackageSources";
import { JobError } from "./jobError";

const DEFAULT_BATCH_SIZE = 10; // matches backfillPackageSources.ts's own default — each item can mean an AI call

type Outcome = { packId: string; slug: string; status: "updated" | "skipped" | "failed"; detail?: string };

/** Mirrors `backfillPackageSources.ts`'s candidate filter exactly. Like
 * storage_audit (and unlike key_rewrap), this needs a real id cursor: a pack
 * that's "skipped" (no AI match, or already-complete) stays in this filter
 * forever — re-querying the same WHERE clause without a cursor would hit the
 * same skipped pack on every tick and never reach the ones after it. */
async function nextBatch(cursor: string | null, batchSize: number) {
  return findMissingSourcePackages(batchSize, cursor ?? undefined);
}

// Same filter as findMissingSourcePackages in backfillPackageSources.ts —
// duplicated here only because that function always does a findMany (it
// needs the full select+cursor shape for paging), and a preview just wants
// a count against the identical WHERE clause.
export async function previewBackfill() {
  const totalCount = await prisma.readinessPack.count({
    where: {
      OR: [
        { sourceName: null }, { sourceTitle: null }, { sourceUrl: null }, { lastCheckedAt: null },
        { verificationSources: { equals: Prisma.DbNull } }, { verificationStatus: { not: "verified" } },
      ],
    },
  });
  return { totalCount };
}

export async function getRunningBackfillJob() {
  return prisma.job.findFirst({
    where: { type: "package_source_backfill", status: { in: ["running", "paused"] } },
    orderBy: { createdAt: "desc" },
  });
}

type AdminCtx = { adminId: string; actorEmail: string };

export async function startBackfillJob(ctx: AdminCtx, opts: { useAi?: boolean; batchSize?: number } = {}) {
  const existing = await getRunningBackfillJob();
  if (existing) throw new JobError("A source backfill is already running or paused. Resume or let it finish first.", 409);

  const { totalCount } = await previewBackfill();
  const useAi = opts.useAi ?? true; // the job's whole purpose is AI-assisted backfill; with useAi:false every candidate is a no-op skip
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  return prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        type: "package_source_backfill", status: "running", totalCount,
        params: { useAi, batchSize }, resultSummary: { outcomes: [] },
        startedByAdminId: ctx.adminId, approvedByAdminId: ctx.adminId,
      },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "job.package_source_backfill.start",
      targetType: "Job", targetId: job.id, diff: { totalCount, useAi },
    });
    return job;
  });
}

/** Per-pack failures (a bad AI response, a transient provider error) don't
 * halt the sweep — same reasoning as storage_audit, and it's what the
 * original CLI script itself does (try/catch per pack, keeps going). Only a
 * genuinely stuck candidate (never shrinks, never advances) would be a
 * problem, and the cursor always advances regardless of outcome, so that
 * can't happen here. */
export async function tickBackfillJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobError("Job not found.", 404);
  if (job.type !== "package_source_backfill") throw new JobError("Not a source backfill job.", 400);
  if (job.status === "completed" || job.status === "failed") return job;
  if (job.status === "paused") throw new JobError("Job is paused. Resume it first.", 409);

  const params = job.params as { useAi?: boolean; batchSize?: number } | null;
  const useAi = params?.useAi ?? true;
  const batchSize = params?.batchSize ?? DEFAULT_BATCH_SIZE;

  const batch = await nextBatch(job.cursor, batchSize) as PackageForBackfill[];

  if (batch.length === 0) {
    const completed = await prisma.job.update({
      where: { id: jobId }, data: { status: "completed", completedAt: new Date() },
    });
    await writeAuditLog(prisma, {
      adminId: job.startedByAdminId, actorEmail: "system", action: "job.package_source_backfill.complete",
      targetType: "Job", targetId: jobId,
      diff: { processedCount: completed.processedCount, updatedCount: completed.updatedCount, failedCount: completed.failedCount },
    });
    return completed;
  }

  const sourceCache = new Map<string, SourceMetadata | null>();
  const outcomes: Outcome[] = [];
  let updated = 0;
  let failed = 0;

  for (const pack of batch) {
    try {
      const cacheKey = cacheKeyForPack(pack);
      const metadata = sourceCache.has(cacheKey) ? sourceCache.get(cacheKey)! : await resolveSourceMetadata(pack, useAi);
      sourceCache.set(cacheKey, metadata);

      if (!metadata) {
        outcomes.push({ packId: pack.id, slug: pack.slug, status: "skipped", detail: "No official source found." });
        continue;
      }
      const update = sourceUpdateForPack(pack, metadata);
      if (!Object.keys(update).length) {
        outcomes.push({ packId: pack.id, slug: pack.slug, status: "skipped", detail: "Source metadata already complete." });
        continue;
      }
      await prisma.readinessPack.update({ where: { id: pack.id }, data: update });
      updated += 1;
      outcomes.push({ packId: pack.id, slug: pack.slug, status: "updated", detail: Object.keys(update).join(", ") });
    } catch (error) {
      failed += 1;
      outcomes.push({ packId: pack.id, slug: pack.slug, status: "failed", detail: error instanceof Error ? error.message : "Unknown error." });
    }
  }

  const existingOutcomes = ((job.resultSummary as { outcomes?: Outcome[] } | null)?.outcomes) ?? [];
  const nextCursor = batch[batch.length - 1]!.id;

  return prisma.job.update({
    where: { id: jobId },
    data: {
      cursor: nextCursor,
      processedCount: { increment: batch.length },
      updatedCount: { increment: updated },
      failedCount: { increment: failed },
      resultSummary: { outcomes: [...existingOutcomes, ...outcomes] },
    },
  });
}

export async function pauseBackfillJob(ctx: AdminCtx, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobError("Job not found.", 404);
  if (job.status !== "running") throw new JobError("Only a running job can be paused.", 409);
  await writeAuditLog(prisma, { adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "job.package_source_backfill.pause", targetType: "Job", targetId: jobId });
  return prisma.job.update({ where: { id: jobId }, data: { status: "paused" } });
}

export async function resumeBackfillJob(ctx: AdminCtx, jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new JobError("Job not found.", 404);
  if (job.status !== "paused") throw new JobError("Only a paused job can be resumed.", 409);
  await writeAuditLog(prisma, { adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "job.package_source_backfill.resume", targetType: "Job", targetId: jobId });
  return prisma.job.update({ where: { id: jobId }, data: { status: "running" } });
}
