import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";

export const FREE_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;
export const FREE_AI_ACTION_LIMIT = 3;
export const quotaPeriod = (now = new Date()) => now.toISOString().slice(0, 7); // UTC calendar month

type Tx = Prisma.TransactionClient | PrismaClient;

/** The single active override for a user, if any — "active" means not
 * revoked and not past its (required) expiry. At most one should exist at a
 * time; granting a new override supersedes whatever was active (see
 * adminUsage.service.ts), so `findFirst` ordered by recency is sufficient
 * rather than ambiguous. Every caller that uses this result to gate a write
 * (enforceStorage, consumeAIAction) must call it on the same `tx` as the
 * row lock from `lockAccount`, so the override can't change out from under a
 * concurrent request — see withStorageUpload and documents.routes.ts for the
 * pattern. getAccountUsage calls it unlocked since it's read-only display. */
async function activeOverride(tx: Tx, userId: string, now: Date) {
  return tx.userLimitOverride.findFirst({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
}

export class UsageLimitError extends Error {
  constructor(
    readonly code: "STORAGE_LIMIT_EXCEEDED" | "AI_MONTHLY_LIMIT_EXCEEDED",
    readonly metadata: Record<string, number | string>,
  ) {
    // Built from the actual limit in `metadata`, not a hardcoded "50 MB" /
    // "3 AI actions" — those stopped being universally true the moment a
    // per-user override could set a different limit (an override holder
    // would otherwise see a wrong number in their own error message).
    super(code === "STORAGE_LIMIT_EXCEEDED"
      ? `This upload would exceed your ${Math.round(Number(metadata.limitBytes) / (1024 * 1024))} MB cloud storage limit.`
      : `You've used your ${metadata.limit} AI action${metadata.limit === 1 ? "" : "s"} for this month.`);
  }
  readonly statusCode = 429;
}

export async function lockAccount(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ accountTier: "free" | "paid" }>>`
    SELECT "accountTier" FROM "User" WHERE id = ${userId} FOR UPDATE`;
  if (!rows[0]) throw Object.assign(new Error("Unauthorized."), { statusCode: 401 });
  return rows[0].accountTier;
}

// Union parent/file references by physical storage key; the parent aliases page 1.
// Drive-only indexes (empty path/key) and temporary review uploads retain no vault file.
// Ciphertext length includes encryption overhead; legacy rows fall back to recorded size.
export async function storedBytes(userId: string, db: Prisma.TransactionClient = prisma, excludeId: string | null = null) {
  const [row] = await db.$queryRaw<Array<{ bytes: bigint }>>`
    SELECT COALESCE(SUM(bytes), 0)::bigint AS bytes FROM (
      SELECT key, MAX(bytes) AS bytes FROM (
        SELECT d."storageUsageKey" AS key,
          COALESCE(d."encryptedSize", d.size)::bigint AS bytes
        FROM "Document" d WHERE d."ownerProfileId" = ${userId}
          AND (${excludeId}::text IS NULL OR d.id <> ${excludeId})
        UNION ALL
        SELECT f."storageUsageKey" AS key, COALESCE(f."encryptedSize", f.size)::bigint AS bytes
        FROM "DocumentFile" f JOIN "Document" d ON d.id = f."documentId"
        WHERE d."ownerProfileId" = ${userId}
          AND (${excludeId}::text IS NULL OR d.id <> ${excludeId})
        UNION ALL
        SELECT "storageKey" AS key, "sizeBytes" AS bytes FROM "storage_cleanup" WHERE "ownerUserId" = ${userId}
      ) objects WHERE key IS NOT NULL AND key <> '' GROUP BY key
    ) retained`;
  return Number(row?.bytes ?? 0);
}

// `limitBytes` defaults to the free-tier constant so every existing call
// site keeps behaving exactly as before unless it explicitly resolves and
// passes an override's limit (resolveStorageLimitBytes).
export function enforceStorage(tier: "free" | "paid", usageBytes: number, incomingBytes: number, limitBytes = FREE_STORAGE_LIMIT_BYTES) {
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0) throw new Error("Invalid stored byte count.");
  if (tier === "free" && usageBytes + incomingBytes > limitBytes) {
    throw new UsageLimitError("STORAGE_LIMIT_EXCEEDED", { usageBytes, limitBytes, incomingBytes });
  }
}

/** Resolves the effective storage limit for a free-tier user, given any
 * active override — call on the same locked `tx` as `enforceStorage`. A
 * paid user has no limit regardless, so callers skip this for `tier ===
 * "paid"` rather than querying pointlessly. */
export async function resolveStorageLimitBytes(tx: Prisma.TransactionClient, userId: string, now = new Date()) {
  const override = await activeOverride(tx, userId, now);
  return override?.storageLimitBytes ?? FREE_STORAGE_LIMIT_BYTES;
}

export async function withStorageUpload<T>(userId: string, incomingBytes: number, replacementId: string | null,
  save: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    const tier = await lockAccount(tx, userId);
    // Validate replacement ownership under the same lock as the allowance and save.
    if (replacementId) await tx.document.findFirstOrThrow({ where: { id: replacementId, ownerProfileId: userId } });
    const usedBytes = await storedBytes(userId, tx, replacementId);
    const limitBytes = tier === "free" ? await resolveStorageLimitBytes(tx, userId) : FREE_STORAGE_LIMIT_BYTES;
    enforceStorage(tier, usedBytes, incomingBytes, limitBytes);
    return save(tx);
  }, { maxWait: 30_000, timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

// Called once immediately before the first real provider attempt. Internal retries reuse it.
export async function consumeAIAction(userId: string, now?: Date, signal?: AbortSignal) {
  return prisma.$transaction(async tx => {
    const tier = await lockAccount(tx, userId);
    signal?.throwIfAborted();
    const period = quotaPeriod(now ?? new Date());
    if (tier === "paid") return;
    const override = await activeOverride(tx, userId, now ?? new Date());
    const limit = override?.aiActionLimit ?? FREE_AI_ACTION_LIMIT;
    const usage = await tx.userAIUsage.upsert({
      where: { userId_period: { userId, period } }, create: { userId, period }, update: {},
    });
    if (usage.actionCount >= limit) {
      throw new UsageLimitError("AI_MONTHLY_LIMIT_EXCEEDED", { used: usage.actionCount, limit, period });
    }
    await tx.userAIUsage.update({ where: { userId_period: { userId, period } }, data: { actionCount: { increment: 1 } } });
    return period;
  });
}

// Refund only a reservation cancelled before fetch was invoked, never an attempted provider call.
export async function releaseUninvokedAIAction(userId: string, period: string) {
  await prisma.$transaction(async tx => {
    await lockAccount(tx, userId);
    await tx.userAIUsage.updateMany({ where: { userId, period, actionCount: { gt: 0 } }, data: { actionCount: { decrement: 1 } } });
  });
}

export async function getAccountUsage(userId: string, now = new Date()) {
  const period = quotaPeriod(now ?? new Date());
  const [user, usedBytes, usage, override] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { accountTier: true } }),
    storedBytes(userId),
    prisma.userAIUsage.findUnique({ where: { userId_period: { userId, period } } }),
    activeOverride(prisma, userId, now), // read-only display snapshot, no lock needed
  ]);
  if (!user) throw Object.assign(new Error("Unauthorized."), { statusCode: 401 });
  const tier = user.accountTier;
  const unlimited = tier === "paid";
  const used = usage?.actionCount ?? 0;
  const storageLimitBytes = override?.storageLimitBytes ?? FREE_STORAGE_LIMIT_BYTES;
  const aiActionLimit = override?.aiActionLimit ?? FREE_AI_ACTION_LIMIT;
  return {
    accountTier: tier,
    storage: { usedBytes, limitBytes: unlimited ? null : storageLimitBytes, unlimited },
    aiUsage: { used: unlimited ? null : used, limit: unlimited ? null : aiActionLimit,
      remaining: unlimited ? null : Math.max(0, aiActionLimit - used), unlimited, period },
    // Additive, optional field — only present (non-null) for a free-tier
    // account with an active admin-granted exception. Existing consumers of
    // this response (customer app's /api/bootstrap/usage, admin Users
    // detail) that don't know about it are unaffected.
    override: unlimited || !override ? null : {
      storageLimitBytes: override.storageLimitBytes, aiActionLimit: override.aiActionLimit,
      reason: override.reason, expiresAt: override.expiresAt,
    },
  };
}
