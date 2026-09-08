import { createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { verifyGoogleCredential } from './googleIdentity.service';
import { sendRecoveryKeyEmail } from './email/emailService';

const proof = z.string().regex(/^[a-f0-9]{64}$/);
const saveSchema = z.object({
  proof, expectedVersion: z.number().int().nonnegative(), acknowledged: z.literal(true),
  password: z.string().max(1024).optional(), credential: z.string().max(16384).optional(),
}).strict();
const emailSchema = saveSchema.extend({
  recoveryDocument: z.string().min(1).max(4096),
}).strict();
const redeemSchema = z.object({ email: z.string().email().max(254), proof, password: z.string().min(8).max(1024) }).strict();
const failure = () => Object.assign(new Error('Unable to recover this account. Check your details and try again.'), { statusCode: 400 });
export function recoveryVerifier(value: string) {
  return createHash('sha256').update('readiness:account-recovery:verifier:v1:').update(value).digest('hex');
}

export async function getRecoveryStatus(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { recoveryVerifier: true, recoveryVersion: true, recoveryCreatedAt: true, recoverySetupComplete: true, passwordHash: true, externalIdentities: { select: { provider: true } } } });
  return { configured: Boolean(user.recoveryVerifier), version: user.recoveryVersion, createdAt: user.recoveryCreatedAt, recoverySetupComplete: user.recoverySetupComplete, passwordAvailable: Boolean(user.passwordHash), googleAvailable: user.externalIdentities.some(identity => identity.provider === 'google') };
}

async function verifyRecoveryUser(userId: string, data: z.infer<typeof saveSchema>) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { externalIdentities: true } });
  let verified = Boolean(user.passwordHash && data.password && await bcrypt.compare(data.password, user.passwordHash));
  if (!verified && data.credential) {
    const google = await verifyGoogleCredential({ credential: data.credential });
    verified = user.externalIdentities.some(identity => identity.provider === 'google' && identity.providerAccountId === google.subject);
  }
  if (!verified) throw Object.assign(new Error('Confirm your password or Google account to save your recovery key.'), { statusCode: 401 });
  return user;
}

async function saveVerifiedRecoveryKey(userId: string, data: z.infer<typeof saveSchema>, authVersion: number) {
  const updated = await prisma.user.updateMany({
    where: { id: userId, recoveryVersion: data.expectedVersion, authVersion },
    data: { recoveryVerifier: recoveryVerifier(data.proof), recoveryVersion: { increment: 1 }, recoveryCreatedAt: new Date(), recoverySetupComplete: true },
  });
  if (updated.count !== 1) throw Object.assign(new Error('Your recovery settings changed. Reload and try again.'), { statusCode: 409 });
}

export async function saveRecoveryKey(userId: string, input: unknown) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) throw failure(); // Never pass credential-bearing validation errors to logs.
  const user = await verifyRecoveryUser(userId, parsed.data);
  await saveVerifiedRecoveryKey(userId, parsed.data, user.authVersion);
  return getRecoveryStatus(userId);
}

export async function emailRecoveryKey(userId: string, input: unknown) {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) throw failure();
  const user = await verifyRecoveryUser(userId, parsed.data);
  const sent = await sendRecoveryKeyEmail({ id: user.id, email: user.email }, parsed.data.recoveryDocument);
  if (!sent.sent) throw Object.assign(new Error('Unable to send recovery key email. Download your key instead.'), { statusCode: 502 });
  await saveVerifiedRecoveryKey(userId, parsed.data, user.authVersion);
  return getRecoveryStatus(userId);
}

export async function redeemRecoveryKey(input: unknown) {
  const parsed = redeemSchema.safeParse(input);
  if (!parsed.success) throw failure();
  const data = parsed.data;
  const user = await prisma.user.findUnique({ where: { email: data.email.trim().toLowerCase() } });
  const candidate = recoveryVerifier(data.proof);
  const stored = user?.recoveryVerifier ?? '0'.repeat(64);
  if (!timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(stored, 'hex')) || !user?.recoveryVerifier) throw failure();
  const passwordHash = await bcrypt.hash(data.password, 10);
  await prisma.$transaction(async tx => {
    const claimed = await tx.user.updateMany({
      where: { id: user.id, recoveryVersion: user.recoveryVersion, recoveryVerifier: candidate, authVersion: user.authVersion },
      data: { passwordHash, recoveryVerifier: null, recoverySetupComplete: false, authVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) throw failure();
    await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  });
  return { message: 'Account recovered. Sign in with your new password and save a new recovery key.' };
}
