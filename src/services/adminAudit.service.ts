import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { withAdminAccess } from "../privacy/access";

type AuditEntry = {
  adminId: string | null;
  actorEmail: string;
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  diff?: unknown; // must already be allowlisted by the caller — never a raw Prisma row
};

type Tx = Prisma.TransactionClient | PrismaClient;

function hashRow(entry: AuditEntry, prevHash: string | null, at: Date) {
  // Deterministic serialization: key order is fixed, not Object.keys() order.
  const material = JSON.stringify({
    prevHash,
    at: at.toISOString(),
    adminId: entry.adminId,
    actorEmail: entry.actorEmail,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    reason: entry.reason ?? null,
    diff: entry.diff ?? null,
  });
  return createHash("sha256").update(material).digest("hex");
}

/** Appends one row to the hash chain. Always call this *inside* the same
 * transaction as the change it describes (decision D4): if the audit insert
 * fails, the change rolls back with it, so no admin write can exist without a
 * corresponding audit row — including a denied/failed attempt, which callers
 * should still log (with adminId null if auth never completed). */
export async function writeAuditLog(tx: Tx, entry: AuditEntry) {
  const last = await tx.adminAuditLog.findFirst({ orderBy: { at: "desc" }, select: { hash: true } });
  const at = new Date();
  const prevHash = last?.hash ?? null;
  const hash = hashRow(entry, prevHash, at);
  return tx.adminAuditLog.create({
    data: {
      at,
      adminId: entry.adminId,
      actorEmail: entry.actorEmail,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      reason: entry.reason ?? null,
      diff: (entry.diff ?? undefined) as Prisma.InputJsonValue | undefined,
      prevHash,
      hash,
    },
  });
}

/** Runs `work` and the audit row in one transaction. Use this for every
 * privileged write; `writeAuditLog` directly only for logging pre-auth denials,
 * which have no application change to wrap. */
export async function withAudit<T>(
  entry: AuditEntry,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const result = await work(tx);
    await writeAuditLog(tx, entry);
    return result;
  });
}

// DRAFT (22 Oct) — see the long comment on withAdminAccess in
// src/privacy/access.ts for why this exists and why it's split across two
// files (circular-import constraint). This is the version admin routes
// should actually call: it makes auditing structurally mandatory rather
// than relying on every route author remembering a separate writeAuditLog
// call, the same "enforce via code, not discipline" reasoning behind every
// contract test in this project. Only audits on success, matching the
// existing /admin/v1/users/:id precedent (opening a record that turns out
// not to exist isn't logged as a "view"). Not yet reviewed by Ranjith —
// this entire primitive is a proposal, not a decided design.
export async function withAuditedAdminAccess<T>(
  ctx: { adminId: string; actorEmail: string },
  input: { capability: string; action: string; targetType?: string; targetId?: string },
  work: () => Promise<T>,
): Promise<T> {
  const result = await withAdminAccess({ adminId: ctx.adminId, capability: input.capability }, work);
  await writeAuditLog(prisma, {
    adminId: ctx.adminId, actorEmail: ctx.actorEmail,
    action: input.action, targetType: input.targetType, targetId: input.targetId,
  });
  return result;
}

const RETENTION_FLOOR_DAYS = 365; // DPDP Rules 2025 — security/access log minimum.

/** Phase 4 "Retention jobs (1 year minimum on audit/sign-in logs)" — reports
 * facts, not a verdict. There's no retention *ceiling* specified anywhere in
 * the design doc (only a floor: "AdminAuditLog and SignInEvent both use that
 * as the floor"), so this deliberately doesn't delete anything or compute a
 * single pass/fail boolean that could paper over a judgment call a real
 * compliance review should make itself. What it reports: both tables have
 * been checked (by reading this code, not by this function) to have zero
 * product-code delete paths, and both tables' `userId`/`adminId` foreign keys
 * use `onDelete: SetNull` — so the 1-year floor is a structural property of
 * the schema, not something a running job enforces at the row level. The
 * oldest-row age and counts are the concrete, checkable facts a regulator's
 * question ("are you retaining these for at least a year?") actually needs. */
export async function getRetentionStatus() {
  const [auditOldest, auditCount, signInOldest, signInCount] = await Promise.all([
    prisma.adminAuditLog.findFirst({ orderBy: { at: "asc" }, select: { at: true } }),
    prisma.adminAuditLog.count(),
    prisma.signInEvent.findFirst({ orderBy: { at: "asc" }, select: { at: true } }),
    prisma.signInEvent.count(),
  ]);
  const ageDays = (at: Date | undefined) => (at ? Math.floor((Date.now() - at.getTime()) / 86_400_000) : null);
  return {
    floorDays: RETENTION_FLOOR_DAYS,
    adminAuditLog: { count: auditCount, oldestAt: auditOldest?.at ?? null, oldestAgeDays: ageDays(auditOldest?.at) },
    signInEvent: { count: signInCount, oldestAt: signInOldest?.at ?? null, oldestAgeDays: ageDays(signInOldest?.at) },
    structuralGuarantee: "No product code path deletes rows from either table; both foreign keys use onDelete: SetNull on account/admin deletion, so a hard account or admin deletion never removes the log row, only its live link to the deleted record.",
  };
}

/** Walks the whole chain and reports the first broken link, if any. Intended
 * for the "Verify chain" action in the Audit screen and a scheduled job
 * (Phase 4) — not fast enough to run on every page load at scale. */
export async function verifyAuditChain() {
  const rows = await prisma.adminAuditLog.findMany({ orderBy: { at: "asc" } });
  let prevHash: string | null = null;
  for (const row of rows) {
    const expected = hashRow(
      {
        adminId: row.adminId,
        actorEmail: row.actorEmail,
        action: row.action,
        targetType: row.targetType ?? undefined,
        targetId: row.targetId ?? undefined,
        reason: row.reason ?? undefined,
        diff: row.diff ?? undefined,
      },
      prevHash,
      row.at,
    );
    if (expected !== row.hash) {
      return { intact: false, brokenAt: row.id, checkedCount: rows.length };
    }
    prevHash = row.hash;
  }
  return { intact: true, brokenAt: null, checkedCount: rows.length };
}
