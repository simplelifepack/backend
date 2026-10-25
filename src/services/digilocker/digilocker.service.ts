import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DigiLockerConsentSession } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { loadDigiLockerConfig } from "../../config/digilocker";
import { withPrivateUser } from "../../privacy/access";
import { encryptPrivateValue, decryptPrivateValue } from "../../privacy/fieldEncryption";
import { authorizationUrl, exchangeCode, issuedDocuments, downloadDocument, revokeToken, type LockerDocument } from "./provider";
import { storeLockerDocument, type ImportPhase } from "./importer";

export const COPY_CONSENT_VERSION = "digilocker-copy-v1";
export const COPY_CONSENT_PURPOSE = "Copy selected DigiLocker documents to encrypted ReadiNes storage and process using the existing AI preference.";
type Consent = { id: string; timestamp: string; version: string; purpose: string; references: string[] };
type Progress = { reference: string; phase: ImportPhase; documentId?: string; duplicate?: boolean; message?: string };
type Payload = { verifier?: string; accessToken?: string; documents?: LockerDocument[]; consents?: Consent[]; progress?: Progress[] };
const binding = (session: Pick<DigiLockerConsentSession, "id" | "userId">) => ({ model: "DigiLockerConsentSession", recordId: session.id, ownerId: session.userId, field: "encryptedPayload" });
const read = (session: DigiLockerConsentSession): Payload => ({
  ...(session.encryptedPayload ? decryptPrivateValue<Payload>(session.encryptedPayload, binding(session)) : {}),
  ...(session.encryptedCredentials ? decryptPrivateValue<Payload>(session.encryptedCredentials, { ...binding(session), field: "encryptedCredentials" }) : {}),
});
const seal = (session: Pick<DigiLockerConsentSession, "id" | "userId"> & { expiresAt?: Date | null }, payload: Payload) => {
  const { accessToken, verifier, ...audit } = payload;
  return {
    encryptedPayload: encryptPrivateValue(audit, binding(session)),
    encryptedCredentials: (!session.expiresAt || session.expiresAt > new Date()) && (accessToken || verifier) ? encryptPrivateValue({ ...(accessToken ? { accessToken } : {}), ...(verifier ? { verifier } : {}) }, { ...binding(session), field: "encryptedCredentials" }) : null,
  };
};
// Operational cleanup never decrypts private metadata and preserves copy-consent audits.
let nextCredentialCleanup = 0;
export async function cleanupExpiredDigiLockerCredentials() {
  if (Date.now() < nextCredentialCleanup) return;
  nextCredentialCleanup = Date.now() + 60_000;
  try { await prisma.$executeRaw`UPDATE "digilocker_consent_sessions" SET "encryptedCredentials" = NULL
    WHERE "expiresAt" <= NOW() AND "encryptedCredentials" IS NOT NULL`;
  } catch (error) {
    const candidate = error as { code?: string; meta?: { code?: string; message?: string } };
    if (candidate.code === "P2010" && candidate.meta?.code === "42703" &&
        /encryptedCredentials/.test(candidate.meta.message ?? "")) {
      // Optional cleanup must not prevent the existing application from starting
      // during the code-before-migration window. Keep the throttle on this path.
      console.warn({ event: "digilocker_migration_required", migration: "20261025100000_digilocker_import_payload" });
      return;
    }
    nextCredentialCleanup = 0;
    throw error;
  }
}
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export class DigiLockerDisabledError extends Error {
  statusCode = 503;
  code = "DIGILOCKER_NOT_CONFIGURED";
  constructor() { super("DigiLocker direct-provider production credentials and callback configuration are required."); }
}
export function digilockerStatus() {
  const config = loadDigiLockerConfig();
  return { configured: config.configured, environment: config.environment, provider: "direct", consentVersion: COPY_CONSENT_VERSION,
    message: config.configured ? null : "DigiLocker is not configured. Contact support to enable the connection." };
}
function assertConfigured() { if (!loadDigiLockerConfig().configured) throw new DigiLockerDisabledError(); }
function statusResponse(session: DigiLockerConsentSession) {
  const payload = read(session);
  return { id: session.id, status: session.status, expiresAt: session.expiresAt, progress: payload.progress ?? [] };
}
async function owned(userId: string, id: string) {
  const session = await prisma.digiLockerConsentSession.findFirst({ where: { id, userId } });
  if (!session) throw fail("DigiLocker session not found.", 404);
  return session;
}
async function expire(session: DigiLockerConsentSession) {
  if (session.expiresAt && session.expiresAt <= new Date()) {
    const payload = read(session);
    delete payload.accessToken; delete payload.verifier;
    return prisma.digiLockerConsentSession.update({ where: { id: session.id }, data: { status: "EXPIRED", ...seal(session, payload) } });
  }
  return session;
}
export async function startDigiLockerSession(input: { userId: string }) {
  assertConfigured();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  // Separate single-use state table permits callback owner discovery without decrypting user data.
  const session = await prisma.$transaction(async tx => {
    await tx.externalOAuthState.create({ data: { stateHash: hash(state), userId: input.userId, provider: `digilocker:${id}`, expiresAt } });
    return tx.digiLockerConsentSession.create({ data: { id, userId: input.userId, verificationId: id,
      environment: "production", status: "PENDING", redirectUrl: `${process.env.FRONTEND_URL ?? "http://localhost:5173"}/documents`, requestedDocuments: [],
      expiresAt, ...seal({ id, userId: input.userId }, { verifier }) } });
  });
  return { ...statusResponse(session), authorizationUrl: authorizationUrl(state, createHash("sha256").update(verifier).digest("base64url")) };
}
export async function completeDigiLockerAuthorization(input: { state: string; code?: string; denied?: boolean }) {
  assertConfigured();
  const state = await prisma.$transaction(async tx => {
    const saved = await tx.externalOAuthState.findUnique({ where: { stateHash: hash(input.state) } });
    if (!saved || !saved.provider.startsWith("digilocker:") || saved.usedAt || saved.expiresAt <= new Date()) throw fail("Invalid or expired DigiLocker state.", 400);
    const claim = await tx.externalOAuthState.updateMany({ where: { id: saved.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claim.count !== 1) throw fail("Invalid or expired DigiLocker state.", 400);
    return saved;
  });
  return withPrivateUser(state.userId, async () => {
    const session = await expire(await owned(state.userId, state.provider.slice("digilocker:".length)));
    if (session.status !== "PENDING") throw fail("DigiLocker session is no longer pending.");
    const payload = read(session);
    let token: string | undefined;
    try {
      if (input.denied || !input.code) {
        await prisma.digiLockerConsentSession.update({ where: { id: session.id }, data: { status: "CONSENT_DENIED", ...seal(session, {}) } });
        return { id: session.id, status: "CONSENT_DENIED" };
      }
      if (!payload.verifier) throw fail("DigiLocker authorization expired.");
      const result = await exchangeCode(input.code, payload.verifier);
      token = result.accessToken;
      const documents = await issuedDocuments(token);
      const tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000);
      const updated = await prisma.digiLockerConsentSession.updateMany({ where: { id: session.id, status: "PENDING", cancelledAt: null }, data: {
        status: "AUTHENTICATED", authenticatedAt: new Date(), expiresAt: tokenExpiresAt,
        ...seal({ ...session, expiresAt: tokenExpiresAt }, { accessToken: token, documents, consents: [], progress: [] }),
      } });
      if (updated.count !== 1) throw fail("DigiLocker connection was cancelled.");
      return { id: session.id, status: "AUTHENTICATED" };
    } catch {
      if (token) await revokeToken(token).catch(() => undefined);
      await prisma.digiLockerConsentSession.updateMany({ where: { id: session.id, status: "PENDING" }, data: { status: "FAILED", ...seal(session, {}) } });
      return { id: session.id, status: "FAILED" };
    }
  });
}
export async function refreshDigiLockerSession(userId: string, id: string) { return statusResponse(await expire(await owned(userId, id))); }
export async function cancelDigiLockerSession(userId: string, id: string) {
  const session = await owned(userId, id);
  if (session.status === "IMPORTING") throw fail("Wait for the current import to finish before closing the connection.");
  const payload = read(session);
  if (payload.accessToken) await revokeToken(payload.accessToken).catch(() => undefined);
  delete payload.accessToken; delete payload.verifier;
  return statusResponse(await prisma.digiLockerConsentSession.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), ...seal(session, payload) } }));
}
export async function listDigiLockerDocuments(userId: string, id: string) {
  const session = await expire(await owned(userId, id));
  if (!["AUTHENTICATED", "IMPORTING"].includes(session.status)) throw fail("DigiLocker consent is not complete or has expired.");
  return { session: statusResponse(session), documents: read(session).documents ?? [] };
}
export function validateSelection(payload: Payload, references: string[], version: string, consent: boolean) {
  if (!consent || version !== COPY_CONSENT_VERSION) throw fail("Explicit copy consent is required.", 400);
  if (!references.length || references.length > 50 || new Set(references).size !== references.length) throw fail("Select between 1 and 50 distinct documents.", 400);
  if (references.some(ref => !payload.documents?.some(doc => doc.reference === ref && doc.available))) throw fail("A selected document is unavailable or restricted.", 400);
}
export async function importDigiLockerDocuments(input: { userId: string; sessionId: string; references: string[]; consentVersion: string; consent: boolean }) {
  assertConfigured();
  let session = await expire(await owned(input.userId, input.sessionId));
  if (session.status !== "AUTHENTICATED") throw fail("DigiLocker connection is expired, cancelled, or already importing.");
  const payload = read(session);
  validateSelection(payload, input.references, input.consentVersion, input.consent);
  if (!payload.accessToken) throw fail("Reconnect DigiLocker to import documents.");
  const consent: Consent = { id: randomUUID(), timestamp: new Date().toISOString(), version: COPY_CONSENT_VERSION, purpose: COPY_CONSENT_PURPOSE, references: input.references };
  payload.consents = [...(payload.consents ?? []), consent];
  // Claim and record explicit consent before fetching any file bytes. Concurrent requests cannot double-import.
  const claimed = await prisma.digiLockerConsentSession.updateMany({ where: { id: session.id, userId: input.userId, status: "AUTHENTICATED" },
    data: { status: "IMPORTING", ...seal(session, payload) } });
  if (claimed.count !== 1) throw fail("An import is already running.");
  const updateProgress = async (reference: string, progress: Omit<Progress, "reference">) => {
    payload.progress = [...(payload.progress ?? []).filter(p => p.reference !== reference), { reference, ...progress }];
    await prisma.digiLockerConsentSession.update({ where: { id: session.id }, data: { ...seal(session, payload), lastCheckedAt: new Date() } });
  };
  try {
    for (const reference of input.references) {
      if (payload.progress?.some(p => p.reference === reference && p.phase === "Completed")) continue;
      let content: Buffer | undefined;
      try {
        if (!session.expiresAt || session.expiresAt <= new Date()) throw fail("DigiLocker session expired. Reconnect to retry.");
        await updateProgress(reference, { phase: "Importing" });
        const document = payload.documents!.find(doc => doc.reference === reference)!;
        content = await downloadDocument(payload.accessToken, reference);
        const result = await storeLockerDocument(input.userId, document, content, { sessionId: session.id, id: consent.id, timestamp: consent.timestamp, version: consent.version },
          phase => updateProgress(reference, { phase }));
        await updateProgress(reference, { phase: "Completed", ...result });
      } catch (error) {
        const code = (error as { code?: string }).code;
        await updateProgress(reference, { phase: "Failed", message: code === "STORAGE_LIMIT_EXCEEDED" ? "Storage limit reached. Free space or upgrade, then retry." : "Import failed. Reconnect if access expired, then retry this document." });
      } finally { content?.fill(0); }
    }
  } finally {
    session = await prisma.digiLockerConsentSession.update({ where: { id: session.id }, data: { status: session.expiresAt && session.expiresAt <= new Date() ? "EXPIRED" : "AUTHENTICATED", ...seal(session, payload) } });
  }
  return statusResponse(session);
}
