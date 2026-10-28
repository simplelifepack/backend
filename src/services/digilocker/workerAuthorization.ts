import { createHash, timingSafeEqual } from "node:crypto";

// The scheduler keeps its bearer token in Vault. Only its digest is deployed.
export function authorizedWorker(header: string | undefined, cronSecret = process.env.CRON_SECRET, schedulerDigest = process.env.DIGILOCKER_WORKER_TOKEN_SHA256) {
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice(7);
  if (!token) return false;
  if (cronSecret) {
    const expected = Buffer.from(cronSecret);
    const actual = Buffer.from(token);
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  }
  if (!schedulerDigest || !/^[a-f0-9]{64}$/.test(schedulerDigest)) return false;
  return timingSafeEqual(createHash("sha256").update(token).digest(), Buffer.from(schedulerDigest, "hex"));
}
