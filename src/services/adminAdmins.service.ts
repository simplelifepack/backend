import type { AdminRole } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { withAudit, writeAuditLog } from "./adminAudit.service";

export class AdminAdminsError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AdminAdminsError";
    this.statusCode = statusCode;
  }
}

type AdminCtx = { adminId: string; actorEmail: string };
const ROLES: AdminRole[] = ["support", "catalogue", "ops_security", "owner"];

export async function listAdmins() {
  const admins = await prisma.adminUser.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true, email: true, name: true, role: true, disabledAt: true, lastLoginAt: true, createdAt: true,
      _count: { select: { passkeys: true } },
      sessions: { where: { revokedAt: null }, select: { id: true } },
    },
  });
  return admins.map((a) => ({
    id: a.id, email: a.email, name: a.name, role: a.role, disabledAt: a.disabledAt,
    lastLoginAt: a.lastLoginAt, createdAt: a.createdAt,
    passkeyCount: a._count.passkeys, activeSessionCount: a.sessions.length,
  }));
}

export async function getAdminDetail(id: string) {
  const admin = await prisma.adminUser.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, role: true, disabledAt: true, lastLoginAt: true, createdAt: true,
      passkeys: { select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true, transports: true } },
      sessions: {
        orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, ip: true, userAgent: true, createdAt: true, revokedAt: true, stepUpAt: true },
      },
    },
  });
  if (!admin) throw new AdminAdminsError("Admin not found.", 404);
  return admin;
}

async function activeOwnerCount(excludeId?: string) {
  return prisma.adminUser.count({
    where: { role: "owner", disabledAt: null, id: excludeId ? { not: excludeId } : undefined },
  });
}

/** The console path for what `bootstrapAdminUser.ts` does from the CLI — same
 * upsert-by-email shape, but audit-logged (the CLI script has no actor to log
 * against, since it exists precisely for when zero admins exist yet) and
 * gated by the real RBAC/step-up chain instead of shell access to the
 * backend's environment. There's no separate invitation token or email here
 * — admin accounts are provisioned, not self-registered (see
 * `adminAuth.service.ts`'s own comment on `beginAdminLogin`): creating the
 * row here is the whole invitation, and the new admin's first real Google
 * sign-in enrolls their passkey exactly like it always has. */
export async function inviteAdmin(ctx: AdminCtx, input: { email: string; name: string; role: AdminRole }, reason: string) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) throw new AdminAdminsError("An admin with this email already exists.", 409);

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "admin.invite",
      targetType: "AdminUser", targetId: email, reason, diff: { email, name: input.name, role: input.role },
    },
    (tx) => tx.adminUser.create({
      data: { email, name: input.name.trim(), role: input.role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
  );
}

export async function changeAdminRole(ctx: AdminCtx, id: string, role: AdminRole, reason: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id }, select: { id: true, role: true, disabledAt: true } });
  if (!admin) throw new AdminAdminsError("Admin not found.", 404);
  if (admin.role === role) throw new AdminAdminsError(`Admin is already ${role}.`, 409);
  if (admin.role === "owner" && role !== "owner" && !admin.disabledAt) {
    // Moving the last active owner off the role would leave nobody who can
    // manage admins at all (admins.manage is owner-only, approval-gated) —
    // the only recovery would be the CLI bootstrap script again.
    if ((await activeOwnerCount(id)) === 0) {
      throw new AdminAdminsError("Cannot change the last active owner's role — promote another admin to owner first.", 409);
    }
  }

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "admin.role.change",
      targetType: "AdminUser", targetId: id, reason, diff: { from: admin.role, to: role },
    },
    (tx) => tx.adminUser.update({ where: { id }, data: { role }, select: { id: true, role: true } }),
  );
}

export async function setAdminDisabled(ctx: AdminCtx, id: string, disabled: boolean, reason: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id }, select: { id: true, role: true, disabledAt: true } });
  if (!admin) throw new AdminAdminsError("Admin not found.", 404);
  if (ctx.adminId === id && disabled) throw new AdminAdminsError("You cannot disable your own account.", 400);
  if (Boolean(admin.disabledAt) === disabled) throw new AdminAdminsError(`Admin is already ${disabled ? "disabled" : "active"}.`, 409);
  if (disabled && admin.role === "owner" && (await activeOwnerCount(id)) === 0) {
    throw new AdminAdminsError("Cannot disable the last active owner — promote another admin to owner first.", 409);
  }

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: disabled ? "admin.disable" : "admin.enable",
      targetType: "AdminUser", targetId: id, reason,
    },
    async (tx) => {
      const updated = await tx.adminUser.update({
        where: { id }, data: { disabledAt: disabled ? new Date() : null }, select: { id: true, disabledAt: true },
      });
      // adminAuth middleware re-checks the DB on every request (no cache, unlike
      // the customer-side authVersion/revocation cache) — disabledAt alone
      // already blocks the next request, but revoke sessions too so "Active
      // sessions: 0" is immediately accurate rather than stale until expiry.
      if (disabled) await tx.adminSession.updateMany({ where: { adminId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return updated;
    },
  );
}

export async function revokeAdminSession(ctx: AdminCtx, adminId: string, sessionId: string, reason?: string) {
  const session = await prisma.adminSession.findFirst({ where: { id: sessionId, adminId } });
  if (!session) throw new AdminAdminsError("Session not found.", 404);
  if (session.revokedAt) throw new AdminAdminsError("Session is already revoked.", 409);

  return withAudit(
    { adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "admin.session.revoke", targetType: "AdminSession", targetId: sessionId, reason },
    (tx) => tx.adminSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() }, select: { id: true, revokedAt: true } }),
  );
}

const ACCESS_REVIEW_ACTION = "admin.access_review";
const ACCESS_REVIEW_CADENCE_DAYS = 90; // "Quarterly" per the design doc's own Phase 4 roadmap wording.

/** Phase 4 "Quarterly access review" — deliberately not a new table: a
 * review is a fact worth recording ("someone looked at the roster and
 * attested to it"), and `AdminAuditLog` already exists exactly for that —
 * hash-chained, tamper-evident, append-only. Recording it there (rather than
 * a dedicated `AccessReview` model) means one less table and one less place
 * this history could get out of sync with the audit trail it's part of.
 * There's no real scheduler in this dev environment to push a reminder (same
 * story as the audit-chain-verify job's "not actually on a cron" note) —
 * "cadence" here means computing and surfacing overdue-ness from the last
 * recorded review, not an actual notification. */
export async function getAccessReviewStatus() {
  const last = await prisma.adminAuditLog.findFirst({
    where: { action: ACCESS_REVIEW_ACTION },
    orderBy: { at: "desc" },
    select: { at: true, actorEmail: true, reason: true },
  });
  const dueAt = last ? new Date(last.at.getTime() + ACCESS_REVIEW_CADENCE_DAYS * 86_400_000) : null;
  return {
    cadenceDays: ACCESS_REVIEW_CADENCE_DAYS,
    lastReviewedAt: last?.at ?? null,
    lastReviewedBy: last?.actorEmail ?? null,
    lastReviewNote: last?.reason ?? null,
    dueAt,
    overdue: dueAt ? dueAt <= new Date() : true, // never reviewed = overdue from day one
  };
}

export async function recordAccessReview(ctx: AdminCtx, reason: string) {
  await writeAuditLog(prisma, {
    adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: ACCESS_REVIEW_ACTION, reason,
  });
  return getAccessReviewStatus();
}

export { ROLES as ADMIN_ROLES };
