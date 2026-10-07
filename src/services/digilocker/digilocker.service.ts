import crypto from "node:crypto";
import type { DigiLockerConsentSession } from "@prisma/client";

import { isSupportedDigiLockerDocument, loadDigiLockerConfig, SUPPORTED_DIGILOCKER_DOCUMENTS, type SupportedDigiLockerDocument } from "../../config/digilocker";
import { prisma } from "../../lib/prisma";
import { createEncryptedTemporaryUpload } from "../documentFileStorage";
import { encryptDocumentOnBackend } from "../documentHybridEncryption";
import { validateDecryptedDocument, withIsolatedPlaintextFile } from "../documentSecurityValidation";
import { ingestDocument } from "../ingestion/pipeline";
import { createCashfreeDigiLockerClient, DigiLockerDisabledError, type CashfreeDigiLockerClient } from "./cashfreeClient";
import { renderDigiLockerDocumentPdf } from "./pdf";

type StartSessionInput = {
  userId: string;
  redirectBaseUrl: string;
  documentTypes?: SupportedDigiLockerDocument[];
  client?: CashfreeDigiLockerClient;
};

type ImportInput = {
  userId: string;
  sessionId: string;
  documentTypes: SupportedDigiLockerDocument[];
  client?: CashfreeDigiLockerClient;
};

const AUTHENTICATED_STATUS = "AUTHENTICATED";
const TERMINAL_STATUSES = new Set(["EXPIRED", "CONSENT_DENIED", "CANCELLED"]);

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

function normalizeStatus(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z_]+/g, "_") || "PENDING";
}

function callbackUrl(baseUrl: string, sessionId: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("digilocker_session", sessionId);
  return url.toString();
}

export async function startDigiLockerSession(input: StartSessionInput) {
  assertConfigured();
  const config = loadDigiLockerConfig();
  const documentTypes = input.documentTypes?.length ? input.documentTypes : [...SUPPORTED_DIGILOCKER_DOCUMENTS];
  const verificationId = `readiness_${crypto.randomUUID().replace(/-/g, "")}`;
  const session = await prisma.digiLockerConsentSession.create({
    data: {
      userId: input.userId,
      verificationId,
      environment: config.environment,
      status: "PENDING",
      redirectUrl: callbackUrl(input.redirectBaseUrl, verificationId),
      requestedDocuments: documentTypes,
    },
  });
  try {
    const created = await (input.client ?? createCashfreeDigiLockerClient()).createUrl({
      verificationId,
      documentRequested: documentTypes,
      redirectUrl: session.redirectUrl,
    });
    const updated = await prisma.digiLockerConsentSession.update({
      where: { id: session.id },
      data: {
        referenceId: created.referenceId,
        consentUrl: created.url,
        status: normalizeStatus(created.status),
      },
    });
    return statusResponse(updated);
  } catch (error) {
    await prisma.digiLockerConsentSession.update({
      where: { id: session.id },
      data: { status: "FAILED", statusMessage: error instanceof Error ? error.message : "Unable to start DigiLocker consent." },
    }).catch(() => undefined);
    throw error;
  }
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

export async function refreshDigiLockerSession(userId: string, sessionId: string, client = createCashfreeDigiLockerClient()) {
  const session = await findOwnedSession(userId, sessionId);
  if (session.cancelledAt || TERMINAL_STATUSES.has(session.status) || session.status === AUTHENTICATED_STATUS) return statusResponse(session);
  assertConfigured();
  const status = await client.getStatus({ verificationId: session.verificationId, referenceId: session.referenceId });
  const normalized = normalizeStatus(status.status);
  const updated = await prisma.digiLockerConsentSession.update({
    where: { id: session.id },
    data: {
      status: normalized,
      referenceId: status.referenceId ?? session.referenceId,
      availableDocuments: normalized === AUTHENTICATED_STATUS ? session.requestedDocuments : session.availableDocuments,
      authenticatedAt: normalized === AUTHENTICATED_STATUS ? new Date() : session.authenticatedAt,
      lastCheckedAt: new Date(),
      statusMessage: null,
    },
  });
  return statusResponse(updated);
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

function responseFromAnalysis(
  temporaryUpload: Awaited<ReturnType<typeof createEncryptedTemporaryUpload>>,
  analysis: Awaited<ReturnType<typeof ingestDocument>>,
  fallbackType: SupportedDigiLockerDocument,
) {
  const fields = analysis.extractedFields as Record<string, unknown>;
  const documentType = analysis.documentType && analysis.documentType.toLowerCase() !== "unknown"
    ? analysis.documentType
    : fallbackType === "AADHAAR" ? "Aadhaar" : fallbackType === "PAN" ? "PAN Card" : "Driving License";
  return {
    success: true as const,
    document: {
      title: analysis.title || temporaryUpload.originalName,
      category: "Identity" as const,
      documentType,
      uniqueNumber: typeof fields.uniqueIdentifier === "string" ? fields.uniqueIdentifier : analysis.validation.uniqueIdentifier,
      nameOnDocument: typeof fields.name === "string" ? fields.name : null,
      expiryDate: null,
      ownership: "unknown" as const,
    },
    files: [{ tempFileId: temporaryUpload.id, originalName: temporaryUpload.originalName, mimeType: temporaryUpload.detectedMimeType, size: temporaryUpload.size }],
    warnings: analysis.warnings,
  };
}

export async function importDigiLockerDocuments(input: ImportInput) {
  assertConfigured();
  const session = await findOwnedSession(input.userId, input.sessionId);
  if (session.status !== AUTHENTICATED_STATUS) {
    throw Object.assign(new Error("DigiLocker consent is not complete."), { statusCode: 409, code: "DIGILOCKER_CONSENT_INCOMPLETE" });
  }
  const allowed = new Set(session.requestedDocuments);
  const client = input.client ?? createCashfreeDigiLockerClient();
  const results = [];
  for (const documentType of input.documentTypes) {
    if (!allowed.has(documentType)) throw Object.assign(new Error("DigiLocker document was not requested in this consent session."), { statusCode: 403 });
    const payload = await client.getDocument({ verificationId: session.verificationId, referenceId: session.referenceId, documentType });
    const pdf = renderDigiLockerDocumentPdf({ documentType, verificationId: session.verificationId, referenceId: session.referenceId, payload });
    try {
      const filename = `digilocker-${documentType.toLowerCase().replace(/_/g, "-")}.pdf`;
      await validateDecryptedDocument(pdf, {
        originalFilename: filename,
        originalMimeType: "application/pdf",
        originalSize: pdf.length,
      } as Parameters<typeof validateDecryptedDocument>[1]);
      const envelope = encryptDocumentOnBackend(pdf, { filename, mimeType: "application/pdf" });
      const createdUpload = await createEncryptedTemporaryUpload(input.userId, envelope);
      const temporaryUpload = await prisma.temporaryUpload.update({
        where: { id: createdUpload.id },
        data: {
          sourceProvider: "digilocker",
          sourceMessageId: session.verificationId,
          sourceAttachmentId: documentType,
        },
      });
      const analysis = await withIsolatedPlaintextFile(pdf, ".pdf", filePath => ingestDocument({
        path: filePath,
        originalName: filename,
        mimeType: "application/pdf",
        size: pdf.length,
      }));
      results.push({ documentType, status: "ready_for_review", analysis: responseFromAnalysis(temporaryUpload, analysis, documentType) });
    } finally {
      pdf.fill(0);
    }
  }
  return { results };
}
