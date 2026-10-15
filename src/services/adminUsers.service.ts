import { prisma } from "../lib/prisma";
import { noteAuthVersion } from "./authRevocationCache";
import { withAudit } from "./adminAudit.service";

export class AdminUsersError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AdminUsersError";
    this.statusCode = statusCode;
  }
}

type AdminCtx = { adminId: string; actorEmail: string };

export async function changeUserTier(ctx: AdminCtx, userId: string, tier: "free" | "paid", reason: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, accountTier: true } });
  if (!user) throw new AdminUsersError("User not found.", 404);
  if (user.accountTier === tier) throw new AdminUsersError(`User is already on the ${tier} tier.`, 409);

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "user.tier.change",
      targetType: "User", targetId: userId, reason, diff: { from: user.accountTier, to: tier },
    },
    (tx) => tx.user.update({ where: { id: userId }, data: { accountTier: tier }, select: { id: true, accountTier: true } }),
  );
}

/** Suspension takes effect immediately — unlike the self-service 30-day
 * deletion grace period, this is an admin action and the account should lose
 * access now: bump authVersion (invalidates issued access tokens once noted),
 * revoke every outstanding refresh token, and warm the in-process revocation
 * cache so it's enforced on this process immediately rather than waiting for
 * `noteAuthVersion` to propagate — same bundle `scheduleAccountDeletion` and
 * `logoutAll` already use. Login is additionally blocked outright for a
 * suspended account (see auth.service.ts) — this isn't just a sign-out. */
export async function suspendUser(ctx: AdminCtx, userId: string, reason: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, suspendedAt: true } });
  if (!user) throw new AdminUsersError("User not found.", 404);
  if (user.suspendedAt) throw new AdminUsersError("User is already suspended.", 409);

  const result = await withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "user.suspend",
      targetType: "User", targetId: userId, reason, diff: { from: "active", to: "suspended" },
    },
    async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { suspendedAt: new Date(), suspendedReason: reason, authVersion: { increment: 1 } },
        select: { id: true, suspendedAt: true, suspendedReason: true, authVersion: true },
      });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      return updated;
    },
  );
  noteAuthVersion(userId, result.authVersion);
  return result;
}

export async function unsuspendUser(ctx: AdminCtx, userId: string, reason: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, suspendedAt: true } });
  if (!user) throw new AdminUsersError("User not found.", 404);
  if (!user.suspendedAt) throw new AdminUsersError("User is not suspended.", 409);

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "user.unsuspend",
      targetType: "User", targetId: userId, reason, diff: { from: "suspended", to: "active" },
    },
    (tx) => tx.user.update({
      where: { id: userId },
      data: { suspendedAt: null, suspendedReason: null },
      select: { id: true, suspendedAt: true },
    }),
  );
}

/** Admin-visibility side of Phase 4 (readiness-admin-console.html #roadmap):
 * the self-service 30-day delayed deletion and zip export already exist
 * (`accountDeletion.service.ts` / `accountExport.service.ts`) — this is just
 * a support-facing undo, not a new deletion capability. Mirrors
 * `cancelPendingDeletion`'s own guard and effect exactly, reimplemented
 * against the audit transaction's `tx` (not the self-service function's
 * global `prisma`) so the state change and its audit row commit atomically,
 * matching every other mutation in this file. Deliberately does *not* bump
 * authVersion or revoke sessions — cancelling a deletion restores the status
 * quo, it doesn't need to sign the user out the way suspend does. */
export async function cancelDeletionOnBehalf(ctx: AdminCtx, userId: string, reason: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, scheduledDeletionAt: true } });
  if (!user) throw new AdminUsersError("User not found.", 404);
  if (!user.scheduledDeletionAt || user.scheduledDeletionAt <= new Date()) {
    throw new AdminUsersError("This account has no pending deletion to cancel.", 409);
  }

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "user.deletion.cancel",
      targetType: "User", targetId: userId, reason, diff: { wasScheduledFor: user.scheduledDeletionAt },
    },
    (tx) => tx.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: null, scheduledDeletionAt: null },
      select: { id: true, scheduledDeletionAt: true },
    }),
  );
}

/** Job status/metadata only — never `storageKey` (the internal object-store
 * path to the export zip). Nothing in the sealed-data list (#access) names
 * export jobs specifically, but the zip itself is the user's full personal
 * data bundle; an admin seeing that a job exists, its status and when it
 * expires is operational visibility, not a way to reach the file. */
export async function listExportJobsForUser(userId: string) {
  return prisma.accountExportJob.findMany({
    where: { userId },
    select: {
      id: true, status: true, fileName: true, sizeBytes: true, errorMessage: true,
      requestedAt: true, preparedAt: true, expiresAt: true, downloadedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Phase 4 retention/visibility: the `SignInEvent` security log (added 13
 * Oct, written from every customer sign-in path in `auth.service.ts`).
 * Plain metadata only — method/ip/userAgent/timestamp — nothing sealed. */
export async function listSignInEventsForUser(userId: string, limit = 20) {
  return prisma.signInEvent.findMany({
    where: { userId },
    select: { id: true, method: true, ip: true, userAgent: true, at: true },
    orderBy: { at: "desc" },
    take: limit,
  });
}

/** Same bump-authVersion + revoke-refresh-tokens bundle as the customer's own
 * `logoutAll` — this just lets an admin trigger it on someone else's behalf. */
export async function forceSignOutUser(ctx: AdminCtx, userId: string, reason?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new AdminUsersError("User not found.", 404);

  const result = await withAudit(
    { adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "user.signout", targetType: "User", targetId: userId, reason },
    async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { authVersion: { increment: 1 } },
        select: { id: true, authVersion: true },
      });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      return updated;
    },
  );
  noteAuthVersion(userId, result.authVersion);
  return result;
}
