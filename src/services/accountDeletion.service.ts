import { billingService } from "./billing/runtime";
import { prisma } from "../lib/prisma";
import { noteAuthVersion } from "./authRevocationCache";
import { removePermanentFile } from "./documentFileStorage";
import { withPrivateUser } from "../privacy/access";
import { decryptCleanupLocator } from "../privacy/storageLocator";

const DELETE_PHRASE = "delete my account";
const DELETION_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

export async function scheduleAccountDeletion(userId: string, input: unknown) {
  const phrase = (input as { phrase?: unknown } | null)?.phrase;
  if (phrase !== DELETE_PHRASE) throw Object.assign(new Error("Confirmation phrase does not match."), { statusCode: 400 });
  const now = new Date();
  const scheduledDeletionAt = new Date(now.getTime() + DELETION_DELAY_MS);
  const updated = await prisma.$transaction(async tx => {
    await billingService.cancelInTransaction(tx, userId);
    const user = await tx.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: now, scheduledDeletionAt, authVersion: { increment: 1 } },
      select: { authVersion: true },
    });
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    return user;
  }, { maxWait: 15000, timeout: 60000 });
  noteAuthVersion(userId, updated.authVersion);
  return { message: "Account deletion scheduled.", scheduledDeletionAt };
}

export async function cancelPendingDeletion(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { scheduledDeletionAt: true } });
  if (!user?.scheduledDeletionAt || user.scheduledDeletionAt <= new Date()) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { deletionRequestedAt: null, scheduledDeletionAt: null },
  });
  return true;
}

export async function processDueAccountDeletions(now = new Date()) {
  const users = await prisma.user.findMany({
    where: { scheduledDeletionAt: { lte: now } },
    select: { id: true },
    take: 10,
  });
  for (const user of users) {
    await withPrivateUser(user.id, () => hardDeleteAccount(user.id));
  }
  return { processed: users.length };
}

async function hardDeleteAccount(userId: string) {
  await billingService.cancel(userId);
  const [documents, exports, cleanup] = await Promise.all([
    prisma.document.findMany({ where: { ownerProfileId: userId }, select: { storageKey: true, path: true, files: { select: { storageKey: true } } } }),
    prisma.accountExportJob.findMany({ where: { userId, storageKey: { not: null } } }),
    prisma.storageCleanup.findMany({ where: { ownerUserId: userId } }),
  ]);
  const keys = new Set<string>();
  documents.forEach((document) => {
    if (document.storageKey || document.path) keys.add(document.storageKey ?? document.path);
    document.files.forEach((file) => keys.add(file.storageKey));
  });
  exports.forEach((job) => { if (job.storageKey) keys.add(job.storageKey); });
  cleanup.forEach((item) => keys.add(decryptCleanupLocator(item)));
  for (const key of keys) {
    await removePermanentFile(key);
  }
  await prisma.user.delete({ where: { id: userId } });
}
