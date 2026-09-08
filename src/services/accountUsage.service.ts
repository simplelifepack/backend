import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export const FREE_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;
export const FREE_AI_ACTION_LIMIT = 3;
export const quotaPeriod = (now = new Date()) => now.toISOString().slice(0, 7); // UTC calendar month

export class UsageLimitError extends Error {
  constructor(
    readonly code: "STORAGE_LIMIT_EXCEEDED" | "AI_MONTHLY_LIMIT_EXCEEDED",
    readonly metadata: Record<string, number | string>,
  ) {
    super(code === "STORAGE_LIMIT_EXCEEDED"
      ? "This upload would exceed your 50 MB cloud storage limit."
      : "You've used your 3 AI actions for this month.");
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
        SELECT COALESCE(NULLIF(d."storageKey", ''), NULLIF(d.path, '')) AS key,
          COALESCE(d."encryptedSize", d.size)::bigint AS bytes
        FROM "Document" d WHERE d."ownerProfileId" = ${userId}
          AND (${excludeId}::text IS NULL OR d.id <> ${excludeId})
        UNION ALL
        SELECT f."storageKey" AS key, COALESCE(f."encryptedSize", f.size)::bigint AS bytes
        FROM "DocumentFile" f JOIN "Document" d ON d.id = f."documentId"
        WHERE d."ownerProfileId" = ${userId}
          AND (${excludeId}::text IS NULL OR d.id <> ${excludeId})
        UNION ALL
        SELECT "storageKey" AS key, "sizeBytes" AS bytes FROM "storage_cleanup" WHERE "ownerUserId" = ${userId}
      ) objects WHERE key IS NOT NULL AND key <> '' GROUP BY key
    ) retained`;
  return Number(row?.bytes ?? 0);
}

export function enforceStorage(tier: "free" | "paid", usageBytes: number, incomingBytes: number) {
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0) throw new Error("Invalid stored byte count.");
  if (tier === "free" && usageBytes + incomingBytes > FREE_STORAGE_LIMIT_BYTES) {
    throw new UsageLimitError("STORAGE_LIMIT_EXCEEDED", { usageBytes, limitBytes: FREE_STORAGE_LIMIT_BYTES, incomingBytes });
  }
}

export async function withStorageUpload<T>(userId: string, incomingBytes: number, replacementId: string | null,
  save: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    const tier = await lockAccount(tx, userId);
    // Validate replacement ownership under the same lock as the allowance and save.
    if (replacementId) await tx.document.findFirstOrThrow({ where: { id: replacementId, ownerProfileId: userId } });
    const usedBytes = await storedBytes(userId, tx, replacementId);
    enforceStorage(tier, usedBytes, incomingBytes);
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
    const usage = await tx.userAIUsage.upsert({
      where: { userId_period: { userId, period } }, create: { userId, period }, update: {},
    });
    if (usage.actionCount >= FREE_AI_ACTION_LIMIT) {
      throw new UsageLimitError("AI_MONTHLY_LIMIT_EXCEEDED", { used: usage.actionCount, limit: FREE_AI_ACTION_LIMIT, period });
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
  const [user, usedBytes, usage] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { accountTier: true } }),
    storedBytes(userId),
    prisma.userAIUsage.findUnique({ where: { userId_period: { userId, period } } }),
  ]);
  if (!user) throw Object.assign(new Error("Unauthorized."), { statusCode: 401 });
  const tier = user.accountTier;
  const unlimited = tier === "paid";
  const used = usage?.actionCount ?? 0;
  return {
    accountTier: tier,
    storage: { usedBytes, limitBytes: unlimited ? null : FREE_STORAGE_LIMIT_BYTES, unlimited },
    aiUsage: { used: unlimited ? null : used, limit: unlimited ? null : FREE_AI_ACTION_LIMIT,
      remaining: unlimited ? null : Math.max(0, FREE_AI_ACTION_LIMIT - used), unlimited, period },
  };
}
