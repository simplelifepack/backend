import { prisma } from "../lib/prisma";
import { withAudit } from "./adminAudit.service";

export class AdminTrustError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AdminTrustError";
    this.statusCode = statusCode;
  }
}

type AdminCtx = { adminId: string; actorEmail: string };

/** Aggregate only — the sealed-data list (#access) is explicit about this
 * module: "Trust-center content: what a member was given; only counts and
 * status show." This is the whole admin-visible surface for the standalone
 * Trust & sharing page; no per-member browsing here (see
 * `listTrustMembersForUser`/`revokeTrustMemberOnBehalf` below, which live on
 * the Users detail page instead, scoped to one already-identified owner). */
export async function getTrustStats() {
  const now = new Date();
  const [byStatus, locked, pendingInvites, expiredInvites] = await Promise.all([
    prisma.trustMember.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.trustMember.count({ where: { pinLockedUntil: { gt: now } } }),
    prisma.trustMember.count({ where: { status: "INVITED", inviteExpiresAt: { gt: now } } }),
    prisma.trustMember.count({ where: { status: "INVITED", inviteExpiresAt: { lte: now } } }),
  ]);
  const counts = { INVITED: 0, ACTIVE: 0, REVOKED: 0, REJECTED: 0 };
  for (const row of byStatus) counts[row.status] = row._count._all;
  return { byStatus: counts, currentlyLocked: locked, pendingInvites, expiredInvites };
}

/** Identity/status metadata only — name, email, relation, access tier,
 * lockout state. Deliberately never `TrustMemberPermission` (canView/
 * canDownload per module) — that's "what a member was given," the part the
 * sealed-data list actually seals. Scoped to one owner, surfaced on that
 * owner's already-audited Users detail view, not a standalone cross-account
 * list — acting on an abuse report means you already know who the owner is. */
export async function listTrustMembersForUser(ownerUserId: string) {
  return prisma.trustMember.findMany({
    where: { ownerUserId },
    select: {
      id: true, name: true, email: true, relation: true, customRelation: true, accessType: true,
      status: true, invitedAt: true, acceptedAt: true, revokedAt: true, pinAttemptCount: true, pinLockedUntil: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Mirrors the self-service `revokeTrustMember` exactly (status → REVOKED,
 * clear the invite token/expiry) — this just lets an admin do it on an
 * owner's behalf, audit-logged, for an abuse report support can't wait on
 * the owner themselves to act on. */
export async function revokeTrustMemberOnBehalf(ctx: AdminCtx, ownerUserId: string, memberId: string, reason: string) {
  const member = await prisma.trustMember.findFirst({ where: { id: memberId, ownerUserId } });
  if (!member) throw new AdminTrustError("Trust member not found.", 404);
  if (member.status === "REVOKED") throw new AdminTrustError("This trust member is already revoked.", 409);

  return withAudit(
    {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "trust.member.revoke",
      targetType: "TrustMember", targetId: memberId, reason,
      diff: { ownerUserId, previousStatus: member.status, relation: member.relation },
    },
    (tx) => tx.trustMember.update({
      where: { id: memberId },
      data: { status: "REVOKED", revokedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
      select: { id: true, status: true, revokedAt: true },
    }),
  );
}
