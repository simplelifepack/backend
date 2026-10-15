import { prisma } from "../lib/prisma";
import { writeAuditLog } from "./adminAudit.service";

export class AdminUsageError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AdminUsageError";
    this.statusCode = statusCode;
  }
}

const MAX_EXPIRY_DAYS = 90;

type AdminCtx = { adminId: string; actorEmail: string };
type GrantInput = { storageLimitBytes?: number | null; aiActionLimit?: number | null; reason: string; expiresAt: Date };

export async function listOverrides(userId: string) {
  return prisma.userLimitOverride.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function getActiveOverrideFor(userId: string, now = new Date()) {
  return prisma.userLimitOverride.findFirst({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
}

/** Grants a new override, superseding (revoking) whatever was active before —
 * at most one active override per user at a time, so there's never ambiguity
 * about which limit applies (see the model's own doc comment). */
export async function grantOverride(ctx: AdminCtx, userId: string, input: GrantInput) {
  if (input.storageLimitBytes == null && input.aiActionLimit == null) {
    throw new AdminUsageError("Set at least one of storage limit or AI action limit.", 400);
  }
  if (input.storageLimitBytes != null && (!Number.isSafeInteger(input.storageLimitBytes) || input.storageLimitBytes <= 0)) {
    throw new AdminUsageError("Storage limit must be a positive number of bytes.", 400);
  }
  if (input.aiActionLimit != null && (!Number.isInteger(input.aiActionLimit) || input.aiActionLimit <= 0)) {
    throw new AdminUsageError("AI action limit must be a positive whole number.", 400);
  }
  const maxExpiry = new Date(Date.now() + MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  if (input.expiresAt.getTime() > maxExpiry.getTime()) {
    throw new AdminUsageError(`Overrides can't run longer than ${MAX_EXPIRY_DAYS} days — an exception that never really ends is just a silent new default.`, 400);
  }
  if (input.expiresAt.getTime() <= Date.now()) {
    throw new AdminUsageError("Expiry must be in the future.", 400);
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, accountTier: true } });
  if (!user) throw new AdminUsageError("User not found.", 404);
  if (user.accountTier === "paid") {
    throw new AdminUsageError("This account is already on the paid tier (unlimited) — an override wouldn't do anything.", 409);
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.userLimitOverride.updateMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    const created = await tx.userLimitOverride.create({
      data: {
        userId, storageLimitBytes: input.storageLimitBytes ?? null, aiActionLimit: input.aiActionLimit ?? null,
        reason: input.reason, expiresAt: input.expiresAt, grantedByAdminId: ctx.adminId,
      },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "user.usage_override.grant",
      targetType: "User", targetId: userId, reason: input.reason,
      diff: { storageLimitBytes: input.storageLimitBytes ?? null, aiActionLimit: input.aiActionLimit ?? null, expiresAt: input.expiresAt.toISOString() },
    });
    return created;
  });
}

export async function revokeOverride(ctx: AdminCtx, userId: string, reason: string) {
  const active = await getActiveOverrideFor(userId);
  if (!active) throw new AdminUsageError("No active override to revoke.", 409);

  return prisma.$transaction(async (tx) => {
    const revoked = await tx.userLimitOverride.update({
      where: { id: active.id }, data: { revokedAt: new Date() },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "user.usage_override.revoke",
      targetType: "User", targetId: userId, reason,
      diff: { revokedOverrideId: active.id },
    });
    return revoked;
  });
}
