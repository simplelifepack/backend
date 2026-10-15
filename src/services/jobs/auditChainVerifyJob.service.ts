import { prisma } from "../../lib/prisma";
import { verifyAuditChain, writeAuditLog } from "../adminAudit.service";
import { evaluateJobFailedAlerts } from "../alerting.service";

type AdminCtx = { adminId: string; actorEmail: string };

/** Phase 4 "Scheduled audit-chain verification". Unlike the other three job
 * types, this one never chunks: `verifyAuditChain()` already walks the whole
 * table in one pass, and AdminAuditLog's size is bounded by admin team
 * activity, not customer data, so a run always completes synchronously — the
 * Job row this creates is born already `completed` or `failed`, never
 * `running`. Reuses the Job table purely for a persisted, timestamped
 * history of past runs (the "scheduled" part — in production this would be
 * one endpoint on a cron, same story as the other job types' "not wired, UI
 * triggers it instead in dev" note) and for the alerting hook: a broken
 * chain is exactly the kind of thing `evaluateJobFailedAlerts` exists for,
 * so this reuses it for free rather than inventing a second alert path. */
export async function runAuditChainVerifyJob(ctx: AdminCtx) {
  const result = await verifyAuditChain();
  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.job.create({
      data: {
        type: "audit_chain_verify",
        status: result.intact ? "completed" : "failed",
        totalCount: result.checkedCount,
        processedCount: result.checkedCount,
        lastError: result.intact ? null : `Chain broken at row ${result.brokenAt}`,
        resultSummary: result,
        startedByAdminId: ctx.adminId,
        approvedByAdminId: ctx.adminId,
        completedAt: new Date(),
      },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail,
      action: result.intact ? "job.audit_chain_verify.complete" : "job.audit_chain_verify.fail",
      targetType: "Job", targetId: created.id, diff: result,
    });
    return created;
  });
  if (job.status === "failed") await evaluateJobFailedAlerts(job);
  return job;
}

export async function listAuditChainVerifyJobs(limit = 20) {
  return prisma.job.findMany({ where: { type: "audit_chain_verify" }, orderBy: { createdAt: "desc" }, take: limit });
}
