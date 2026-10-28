import { randomUUID } from "node:crypto";
import type { DigiLockerConsentSession } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { withPrivateMaintenance, withPrivateUser } from "../../privacy/access";
import { decryptPrivateValue, encryptPrivateValue } from "../../privacy/fieldEncryption";
import { withImportAdmission } from "../../middleware/resourceLimits";
import { binding, read, revokeSessionCredentials, type Progress, type Payload } from "./digilocker.service";
import { downloadDocument } from "./provider";
import { storeLockerDocument } from "./importer";
import { importFailure } from "./importFailure";

const LEASE_MS = 90_000;
const MAX_ATTEMPTS = 5;
const stopped = () => Object.assign(new Error("Import interrupted."), { code: "IMPORT_INTERRUPTED" });
export const retryDelay = (attempt: number) => Math.min(60_000, 2_000 * 2 ** Math.min(attempt, 5));
export function activeLease(session: DigiLockerConsentSession, token: string, now = new Date()) {
  return session.status === "IMPORTING" && !session.cancelledAt && !!session.expiresAt && session.expiresAt > now &&
    session.importLeaseToken === token && !!session.importLeaseUntil && session.importLeaseUntil > now;
}

// Claim at most one document per invocation. The short advisory transaction
// serializes global admission across serverless instances; it holds no provider I/O.
async function claim() {
  return withPrivateMaintenance("digilocker-worker-claim", () => prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71928105)`;
    const active = await tx.digiLockerConsentSession.count({ where: { status: "IMPORTING", importLeaseUntil: { gt: new Date() } } });
    if (active >= 3) return null;
    const rows = await tx.$queryRaw<Array<{ id: string; userId: string }>>`
      SELECT "id", "userId" FROM "digilocker_consent_sessions"
      WHERE "status" = 'IMPORTING' AND ("importLeaseUntil" IS NULL OR "importLeaseUntil" <= timezone('UTC', CURRENT_TIMESTAMP))
        AND ("importNextAttemptAt" IS NULL OR "importNextAttemptAt" <= timezone('UTC', CURRENT_TIMESTAMP))
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const row = rows[0];
    if (!row) return null;
    const token = randomUUID();
    const leaseUntil = new Date(Date.now() + LEASE_MS);
    await tx.$executeRaw`UPDATE "digilocker_consent_sessions" SET "importLeaseToken" = ${token},
      "importLeaseUntil" = (${leaseUntil} AT TIME ZONE 'UTC'), "importAttempts" = "importAttempts" + 1, "updatedAt" = timezone('UTC', CURRENT_TIMESTAMP)
      WHERE "id" = ${row.id} AND "status" = 'IMPORTING'`;
    return { ...row, token };
  }));
}

export async function runDigiLockerWorker(deadlineMs = 240_000) {
  return withImportAdmission(async () => {
    const lease = await claim();
    if (!lease) return false;
    return withPrivateUser(lease.userId, async () => {
      const session = await prisma.digiLockerConsentSession.findFirstOrThrow({ where: { id: lease.id, userId: lease.userId } });
      let payload: Payload;
      let progress: Progress[];
      try {
        payload = read(session);
        progress = session.encryptedProgress ? decryptPrivateValue<Progress[]>(session.encryptedProgress,
          { ...binding(session), field: "encryptedProgress" }) : payload.progress ?? [];
      } catch {
        // Corrupt ciphertext or an unavailable historical key cannot poison an
        // indefinitely reclaimable job. Keep audit data for key recovery.
        await prisma.digiLockerConsentSession.updateMany({ where: { id: session.id, status: "IMPORTING", importLeaseToken: lease.token },
          data: { status: "FAILED", importLeaseToken: null, importLeaseUntil: null } });
        await revokeSessionCredentials(session).catch(() => undefined);
        return true;
      }
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(new DOMException("Import timed out.", "TimeoutError")), Math.max(1, Math.min(240_000, deadlineMs)));
      const heartbeat = setInterval(() => {
        void prisma.digiLockerConsentSession.updateMany({ where: { id: session.id, status: "IMPORTING", importLeaseToken: lease.token,
          importLeaseUntil: { gt: new Date() }, expiresAt: { gt: new Date() }, cancelledAt: null },
          data: { importLeaseUntil: new Date(Date.now() + LEASE_MS) } }).then(result => {
          if (result.count !== 1) controller.abort();
        }).catch(() => controller.abort());
      }, 5_000);
      let content: Buffer | undefined;
      const consent = payload.consents?.[payload.consents.length - 1];
      let currentReference: string | undefined;
      const persist = async (entry: Progress) => {
        controller.signal.throwIfAborted();
        const index = progress.findIndex(p => p.reference === entry.reference);
        if (index < 0) progress.push(entry); else progress[index] = entry;
        const result = await prisma.digiLockerConsentSession.updateMany({ where: { id: session.id, status: "IMPORTING",
          importLeaseToken: lease.token, importLeaseUntil: { gt: new Date() }, expiresAt: { gt: new Date() }, cancelledAt: null },
          data: { encryptedProgress: encryptPrivateValue(progress, { ...binding(session), field: "encryptedProgress" }), lastCheckedAt: new Date() } });
        if (result.count !== 1) throw stopped();
      };
      try {
        if (!activeLease(session, lease.token) || !payload.accessToken || !consent || session.importAttempts > MAX_ATTEMPTS) throw stopped();
        const reference = consent.references.find(ref => !progress.some(p => p.reference === ref && p.phase === "Completed"));
        currentReference = reference;
        if (reference) {
          const document = payload.documents?.find(doc => doc.reference === reference && doc.available);
          if (!document) throw stopped();
          await persist({ reference, phase: "Importing" });
          const existing = await prisma.document.findFirst({ where: { ownerProfileId: session.userId, deletedAt: null,
            sourceProvider: "DIGILOCKER", sourceMessageId: reference } });
          let result: { documentId: string; duplicate: boolean };
          if (existing) result = { documentId: existing.id, duplicate: true };
          else {
            content = await downloadDocument(payload.accessToken, reference, controller.signal);
            result = await storeLockerDocument(session.userId, document, content, { sessionId: session.id, ...consent },
              phase => persist({ reference, phase }), { token: lease.token, signal: controller.signal });
          }
          await persist({ reference, phase: "Completed", ...result });
        }
        const finished = consent.references.every(ref => progress.some(p => p.reference === ref && p.phase === "Completed"));
        await prisma.digiLockerConsentSession.updateMany({ where: { id: session.id, status: "IMPORTING", importLeaseToken: lease.token, cancelledAt: null,
            expiresAt: { gt: new Date() }, importLeaseUntil: { gt: new Date() } },
          data: { status: finished ? "AUTHENTICATED" : "IMPORTING", importLeaseToken: null, importLeaseUntil: null,
            importAttempts: 0, importNextAttemptAt: new Date() } });
      } catch (error) {
        const diagnostic = importFailure(error);
        const retryable = ["DIGILOCKER_PROVIDER_ERROR", "DIGILOCKER_RATE_LIMITED", "DOCUMENT_SAVE_FAILED", "IMPORT_FAILED"].includes(diagnostic.code);
        const timedOut = controller.signal.reason?.name === "TimeoutError";
        const retry = retryable && session.importAttempts < MAX_ATTEMPTS && (!controller.signal.aborted || timedOut) && !!session.expiresAt && session.expiresAt > new Date();
        if (currentReference && !controller.signal.aborted) await persist({ reference: currentReference, phase: "Failed", message: diagnostic.message }).catch(() => undefined);
        // Partial success survives failure. A manual retry requires new explicit
        // consent; automatic retries replay the same durable consent only.
        const result = await prisma.digiLockerConsentSession.updateMany({ where: { id: session.id, status: "IMPORTING", importLeaseToken: lease.token },
          data: { status: retry ? "IMPORTING" : session.expiresAt && session.expiresAt <= new Date() ? "EXPIRED" : "FAILED",
            importLeaseToken: null, importLeaseUntil: null, importNextAttemptAt: new Date(Date.now() + retryDelay(session.importAttempts)) } });
        if (!retry && result.count) await revokeSessionCredentials(session);
      } finally {
        clearInterval(heartbeat); clearTimeout(deadline); content?.fill(0);
      }
      return true;
    });
  });
}

export async function maintainDigiLockerSessions() {
  const sessions = await withPrivateMaintenance("digilocker-credential-revocation", () => prisma.digiLockerConsentSession.findMany({
    where: { OR: [{ encryptedCredentials: { not: null }, status: { in: ["CANCELLED", "FAILED", "EXPIRED", "CONSENT_DENIED"] } }, { status: { in: ["PENDING", "AUTHENTICATED", "IMPORTING"] }, expiresAt: { lte: new Date() } }] },
    select: { id: true, userId: true }, orderBy: { lastCheckedAt: "asc" }, take: 3,
  }));
  for (const row of sessions) await withPrivateUser(row.userId, async () => {
    const session = await prisma.digiLockerConsentSession.findFirstOrThrow({ where: { id: row.id, userId: row.userId } });
    if (session.expiresAt && session.expiresAt <= new Date()) await prisma.digiLockerConsentSession.updateMany({
      where: { id: row.id, status: { in: ["PENDING", "AUTHENTICATED", "IMPORTING"] }, expiresAt: { lte: new Date() } },
      data: { status: "EXPIRED", importLeaseToken: null, importLeaseUntil: null },
    });
    await revokeSessionCredentials(session).catch(() => console.error({ event: "digilocker_credential_cleanup_failed" }));
    await prisma.digiLockerConsentSession.updateMany({ where: { id: row.id }, data: { lastCheckedAt: new Date() } });
  });
}

// Best-effort wakeups reduce batch latency; PostgreSQL remains authoritative if
// a deployment disappears. The protected scheduler endpoint runs the same drain.
export async function drainDigiLockerQueue(budgetMs = 270_000) {
  const deadline = Date.now() + Math.min(270_000, budgetMs);
  await maintainDigiLockerSessions();
  while (Date.now() < deadline - 1_000) {
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => runDigiLockerWorker(deadline - Date.now() - 500)));
    if (!results.some(result => result.status === "fulfilled" && result.value)) break;
  }
}
