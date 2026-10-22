import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { lockAccount } from './accountUsage.service';
import { removePermanentFile } from './documentFileStorage';
import { decryptCleanupLocator, encryptedCleanupLocator } from '../privacy/storageLocator';

type StoredReference = { storageKey?: string | null; path?: string; encryptedSize?: number | null; size: number };
export async function queueStorageCleanup(tx: Prisma.TransactionClient, ownerUserId: string, references: StoredReference[]) {
  for (const ref of references) {
    const storageKey = ref.storageKey || ref.path;
    if (!storageKey) continue;
    const encrypted = encryptedCleanupLocator(ownerUserId, storageKey);
    await tx.storageCleanup.upsert({ where: { storageKey: encrypted.storageKey },
      create: { ...encrypted, ownerUserId, sizeBytes: ref.encryptedSize ?? ref.size }, update: {},
    });
  }
}
// Delete failures remain durably accounted and retry on usage reads / the next save.
export async function drainStorageCleanup(userId: string) {
  await prisma.$transaction(async tx => {
    await lockAccount(tx, userId);
    const pending = await tx.storageCleanup.findMany({ where: { ownerUserId: userId }, take: 100 });
    for (const file of pending) {
      try { await removePermanentFile(decryptCleanupLocator(file)); }
      catch { continue; }
      await tx.storageCleanup.delete({ where: { storageKey: file.storageKey } });
    }
  }, { maxWait: 30_000, timeout: 60_000 });
}
