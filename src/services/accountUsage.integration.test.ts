import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { consumeAIAction, enforceStorage, FREE_STORAGE_LIMIT_BYTES as LIMIT, getAccountUsage, storedBytes, UsageLimitError, withStorageUpload } from './accountUsage.service';
import { buildErrorResponse } from '../middleware/errorHandling';

const prefix = `usage-test-${crypto.randomUUID()}`;
const free = `${prefix}-free`;
const paid = `${prefix}-paid`;
const document = (owner: string, size: number, id = crypto.randomUUID()) => ({
  id, ownerProfileId: owner, originalName: 'test.bin', storedName: 'test.bin', path: `${owner}/${id}`,
  storageKey: `${owner}/${id}`, mimeType: 'application/octet-stream', size, encryptedSize: size,
  documentType: 'test', category: 'other', analysisSource: 'user', confidence: 0, fields: {},
});
const upload = (owner: string, size: number) => withStorageUpload(owner, size, null, tx => tx.document.create({ data: document(owner, size) }));
const checkLimit = (code: string) => (error: unknown) => {
  assert.ok(error instanceof UsageLimitError);
  assert.equal(error.code, code);
  const result = buildErrorResponse({ error, production: true });
  assert.equal(result.body.code, code);
  return true;
};

async function run() {
  try {
    await prisma.user.createMany({ data: [
      { id: free, name: 'Test', email: `${free}@example.invalid` },
      { id: paid, name: 'Test', email: `${paid}@example.invalid`, accountTier: 'paid' },
    ] });
    assert.equal((await getAccountUsage(free)).accountTier, 'free');
    await upload(free, LIMIT - 10);
    assert.equal(await storedBytes(free), LIMIT - 10);
    await upload(free, 10);
    assert.equal(await storedBytes(free), LIMIT);
    let enteredSave = false;
    await assert.rejects(withStorageUpload(free, 1, null, async () => { enteredSave = true; }), checkLimit('STORAGE_LIMIT_EXCEEDED'));
    assert.equal(enteredSave, false, 'Rejected uploads cannot write permanent objects/documents');
    assert.equal(await prisma.document.count({ where: { ownerProfileId: free } }), 2);
    const small = await prisma.document.findFirstOrThrow({ where: { ownerProfileId: free, size: 10 } });
    await prisma.document.delete({ where: { id: small.id } });
    assert.equal(await storedBytes(free), LIMIT - 10, 'Deletion frees storage');
    const results = await Promise.allSettled([upload(free, 10), upload(free, 10), upload(free, 10)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await storedBytes(free), LIMIT);
    await upload(paid, LIMIT * 2);
    assert.equal((await getAccountUsage(paid)).storage.unlimited, true);
    assert.equal((await getAccountUsage(paid)).storage.limitBytes, null);
    const prior = await prisma.document.findFirstOrThrow({ where: { ownerProfileId: free, size: LIMIT - 10 } });
    await withStorageUpload(free, 12, prior.id, tx => tx.document.update({ where: { id: prior.id }, data: { size: 12, encryptedSize: 12 } }));
    assert.equal(await storedBytes(free), 22, 'Replacement credits the old file');
    await assert.rejects(withStorageUpload(free, 100, null, async tx => {
      await tx.document.create({ data: document(free, 100) }); throw new Error('Storage failure');
    }));
    assert.equal(await storedBytes(free), 22, 'Failed save rolls back');
    await prisma.documentFile.create({ data: { documentId: prior.id, pageIndex: 0, originalName: 'page', mimeType: 'application/octet-stream', size: 12, encryptedSize: 12, storedName: 'page', storageKey: prior.storageKey! } });
    await prisma.documentFile.create({ data: { documentId: prior.id, pageIndex: 1, originalName: 'page', mimeType: 'application/octet-stream', size: 7, encryptedSize: 7, storedName: 'page', storageKey: `${prior.storageKey}/page2` } });
    assert.equal(await storedBytes(free), 29, 'Count all pages without parent double-count');
    await prisma.document.create({ data: { ...document(free, 5000), storageKey: null, path: '', sourceProvider: 'GOOGLE_DRIVE' } });
    assert.equal(await storedBytes(free), 29, 'Drive-only indexes use no retained file bytes');
    const month = new Date('2026-09-30T23:59:59.000Z');
    for (let i = 1; i <= 3; i++) {
      await consumeAIAction(free, month);
      assert.equal((await getAccountUsage(free, month)).aiUsage.used, i);
    }
    await assert.rejects(consumeAIAction(free, month), checkLimit('AI_MONTHLY_LIMIT_EXCEEDED'));
    const nextMonth = new Date('2026-10-01T00:00:00.000Z');
    assert.equal((await getAccountUsage(free, nextMonth)).aiUsage.used, 0);
    await consumeAIAction(free, nextMonth);
    await consumeAIAction(free, nextMonth);
    const actions = await Promise.allSettled(Array.from({ length: 3 }, () => consumeAIAction(free, nextMonth)));
    assert.equal(actions.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await getAccountUsage(free, nextMonth)).aiUsage.used, 3);
    await Promise.all(Array.from({ length: 5 }, () => consumeAIAction(paid, month)));
    assert.deepEqual((await getAccountUsage(paid, month)).aiUsage, { used: null, limit: null, remaining: null, unlimited: true, period: '2026-09' });
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(consumeAIAction(free, new Date('2026-11-01'), cancelled.signal));
    assert.equal((await getAccountUsage(free, new Date('2026-11-01'))).aiUsage.used, 0);
    assert.throws(() => enforceStorage('free', LIMIT, 1), checkLimit('STORAGE_LIMIT_EXCEEDED'));
    console.log('PASS: PostgreSQL storage boundaries, rollback, deletion, replacement, pages, Drive, paid; monthly AI 1/2/3/4, rollover, paid, cancellation and concurrent requests.');
  } finally {
    await prisma.document.deleteMany({ where: { ownerProfileId: { in: [free, paid] } } });
    await prisma.user.deleteMany({ where: { id: { in: [free, paid] } } });
    await prisma.$disconnect();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
