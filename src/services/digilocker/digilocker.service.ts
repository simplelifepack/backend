import type { DigiLockerConsentSession } from "@prisma/client";

import { isSupportedDigiLockerDocument, loadDigiLockerConfig, SUPPORTED_DIGILOCKER_DOCUMENTS, type SupportedDigiLockerDocument } from "../../config/digilocker";
import { prisma } from "../../lib/prisma";

type StartSessionInput = {
  userId: string;
  redirectBaseUrl: string;
  documentTypes?: SupportedDigiLockerDocument[];
};

type ImportInput = {
  userId: string;
  sessionId: string;
  documentTypes: SupportedDigiLockerDocument[];
};

const AUTHENTICATED_STATUS = "AUTHENTICATED";
const TERMINAL_STATUSES = new Set(["EXPIRED", "CONSENT_DENIED", "CANCELLED"]);

export class DigiLockerDisabledError extends Error {
  statusCode = 503;

  constructor() {
    super("DigiLocker integration is coming soon.");
  }
}

export function digilockerStatus() {
  const config = loadDigiLockerConfig();
  return {
    configured: config.configured,
    environment: config.environment,
    supportedDocuments: SUPPORTED_DIGILOCKER_DOCUMENTS,
    message: config.configured ? null : "DigiLocker integration is coming soon.",
  };
}

function assertConfigured() {
  if (!loadDigiLockerConfig().configured) throw new DigiLockerDisabledError();
}

function statusResponse(session: DigiLockerConsentSession) {
  return {
    id: session.id,
    status: session.cancelledAt ? "CANCELLED" : session.status,
    statusMessage: session.statusMessage,
    consentUrl: session.consentUrl,
    requestedDocuments: session.requestedDocuments,
    availableDocuments: session.availableDocuments,
    expiresAt: session.expiresAt,
    authenticatedAt: session.authenticatedAt,
  };
}

export async function startDigiLockerSession(_input: StartSessionInput) {
  assertConfigured();
  throw new DigiLockerDisabledError();
}

async function findOwnedSession(userId: string, sessionId: string) {
  const session = await prisma.digiLockerConsentSession.findFirst({
    where: {
      userId,
      OR: [{ id: sessionId }, { verificationId: sessionId }],
    },
  });
  if (!session) throw Object.assign(new Error("DigiLocker session not found."), { statusCode: 404 });
  return session;
}

export async function cancelDigiLockerSession(userId: string, sessionId: string) {
  const session = await findOwnedSession(userId, sessionId);
  const updated = await prisma.digiLockerConsentSession.update({
    where: { id: session.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), statusMessage: "User cancelled DigiLocker consent." },
  });
  return statusResponse(updated);
}

export async function refreshDigiLockerSession(userId: string, sessionId: string) {
  const session = await findOwnedSession(userId, sessionId);
  if (session.cancelledAt || TERMINAL_STATUSES.has(session.status) || session.status === AUTHENTICATED_STATUS) return statusResponse(session);
  assertConfigured();
  throw new DigiLockerDisabledError();
}

export async function listDigiLockerDocuments(userId: string, sessionId: string) {
  const session = await findOwnedSession(userId, sessionId);
  if (session.status !== AUTHENTICATED_STATUS) {
    throw Object.assign(new Error("DigiLocker consent is not complete."), { statusCode: 409, code: "DIGILOCKER_CONSENT_INCOMPLETE" });
  }
  return {
    session: statusResponse(session),
    documents: session.requestedDocuments.filter(isSupportedDigiLockerDocument).map((type) => ({
      type,
      label: type === "AADHAAR" ? "Aadhaar" : type === "PAN" ? "PAN" : "Driving License",
      status: "available",
    })),
  };
}

export async function importDigiLockerDocuments(input: ImportInput) {
  const session = await findOwnedSession(input.userId, input.sessionId);
  if (session.status !== AUTHENTICATED_STATUS) {
    throw Object.assign(new Error("DigiLocker consent is not complete."), { statusCode: 409, code: "DIGILOCKER_CONSENT_INCOMPLETE" });
  }
  throw new DigiLockerDisabledError();
}
