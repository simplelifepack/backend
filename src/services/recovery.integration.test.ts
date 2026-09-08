import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { getRecoveryStatus, recoveryVerifier, redeemRecoveryKey, saveRecoveryKey } from './recovery.service';
import { login, refresh } from './auth.service';
import { setEmailProviderForTests } from './email/emailService';
import { requireAuth } from '../middleware/requireAuth';
import { decryptHybridDocument, encryptDocumentOnBackend } from './documentHybridEncryption';

async function run() {
  setEmailProviderForTests({ sendEmail: async () => undefined });
  const email = `recovery-${randomBytes(8).toString('hex')}@example.com`;
  const password = randomBytes(24).toString('hex');
  const user = await prisma.user.create({ data: { email, name: 'Recovery Test', passwordHash: await bcrypt.hash(password, 10) } });
  try {
    const status = await getRecoveryStatus(user.id);
    assert.equal(status.configured, false);
    const first = randomBytes(32).toString('hex'); const second = randomBytes(32).toString('hex');
    await assert.rejects(saveRecoveryKey(user.id, { proof: first, expectedVersion: 0, acknowledged: true, password: 'wrong' }));
    await assert.rejects(saveRecoveryKey(user.id, { proof: first, expectedVersion: 0, acknowledged: false, password }));
    await saveRecoveryKey(user.id, { proof: first, expectedVersion: 0, acknowledged: true, password });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(stored.recoveryVerifier, recoveryVerifier(first)); assert.notEqual(stored.recoveryVerifier, first);
    // Database verifier cannot be presented as the recovery credential.
    await assert.rejects(redeemRecoveryKey({ email, proof: stored.recoveryVerifier, password }));
    await assert.rejects(saveRecoveryKey(user.id, { proof: second, expectedVersion: 0, acknowledged: true, password }));
    await saveRecoveryKey(user.id, { proof: second, expectedVersion: 1, acknowledged: true, password });
    await assert.rejects(redeemRecoveryKey({ email, proof: first, password }));
    const session = await login({ email, password });
    const fixture = Buffer.from('private fixture document');
    const envelope = encryptDocumentOnBackend(fixture, { filename: 'fixture.txt', mimeType: 'application/pdf' });
    const newPassword = randomBytes(24).toString('hex');
    const results = await Promise.allSettled([
      redeemRecoveryKey({ email, proof: second, password: newPassword }),
      redeemRecoveryKey({ email, proof: second, password: newPassword }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    await assert.rejects(refresh({ refreshToken: session.refreshToken }));
    let httpStatus = 0; let admitted = false;
    const response = { status: (value: number) => { httpStatus = value; return response; }, json: () => response };
    await requireAuth({ headers: { authorization: `Bearer ${session.accessToken}` } } as never, response as never, () => { admitted = true; });
    assert.equal(httpStatus, 401); assert.equal(admitted, false);
    const restored = await login({ email, password: newPassword });
    assert.ok(restored.accessToken);
    assert.equal((await getRecoveryStatus(user.id)).configured, false);
    const decrypted = decryptHybridDocument(envelope.ciphertext, envelope);
    assert.deepEqual(decrypted, fixture); decrypted.fill(0); fixture.fill(0);
    await assert.rejects(redeemRecoveryKey({ email, proof: second, password: newPassword }));
    console.log('Recovery integration passed: setup, reauthentication, rotation, stale version rejection, hashed verifier, single-use race, session invalidation, and unchanged document decryption. No emails sent.');
  } finally { await prisma.user.delete({ where: { id: user.id } }); await prisma.$disconnect(); }
}
run().catch(error => { console.error(error instanceof Error ? error.name : 'Recovery test failed'); process.exitCode = 1; });
