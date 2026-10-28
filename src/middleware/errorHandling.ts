import { documentValidationMessages, fileTooLargeMessage } from "../services/documentValidationMessages";
import { DocumentEnvelopeError } from "../services/documentEnvelopeValidation";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "../services/documentUploadLimits";
import { UsageLimitError } from "../services/accountUsage.service";
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function statusCodeForError(error: unknown) {
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown };
  if (candidate?.name === "ZodError") return 400;
  if (candidate?.name === "MulterError") {
    return candidate.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  }
  if (error instanceof Error && error.message === "INVALID_ENCRYPTION_ENVELOPE") return 400;
  const status =
    typeof candidate.statusCode === "number"
      ? candidate.statusCode
      : typeof candidate.status === "number"
        ? candidate.status
        : 500;
  return status >= 400 && status < 600 ? status : 500;
}

export function sanitizeDiagnosticMessage(message: string) {
  return message
    .replace(process.cwd(), "[app-root]")
    .replace(/\/(?:Users|private|tmp|var)\/[^\s'")]+/g, "[path]");
}

export function moduleLoadDiagnostic(error: Error) {
  const code = (error as Error & { code?: unknown }).code;
  if (code !== "MODULE_NOT_FOUND" && code !== "ERR_MODULE_NOT_FOUND" && code !== "ERR_REQUIRE_ESM") return {};
  const specifier = error.message.match(/Cannot find (?:module|package) ['"]([^'"]+)['"]/)?.[1];
  const moduleName = specifier && /^(?:@?[a-zA-Z0-9_-]+)(?:\/[a-zA-Z0-9_.-]+)*$/.test(specifier) ? specifier : undefined;
  return { code, ...(moduleName ? { moduleName } : {}) };
}

export function buildErrorResponse(input: {
  error: unknown;
  production: boolean;
  errorId?: string;
}) {
  if (input.error instanceof UsageLimitError) return {
    status: input.error.statusCode,
    body: { success: false, code: input.error.code, message: input.error.message, ...input.error.metadata },
  };
  const errorId = input.errorId ?? crypto.randomUUID();
  const status = statusCodeForError(input.error);
  const candidateCode = input.error instanceof Error && input.error.message === "INVALID_ENCRYPTION_ENVELOPE"
    ? "INVALID_ENCRYPTION_ENVELOPE" : (input.error as { code?: unknown })?.code;
  if (candidateCode === "DOCUMENT_FILE_MISSING") {
    return {
      status,
      body: {
        code: "DOCUMENT_FILE_MISSING",
        message: "The saved document file is no longer available. Please re-upload the document.",
        errorId,
      },
    };
  }
  const safeCodes = new Set([
    "EMPTY_FILE",
    "IMAGE_DIMENSIONS_EXCEEDED",
    "PDF_PAGE_LIMIT_EXCEEDED",
    "UNSUPPORTED_FILE_TYPE",
    "FILE_TOO_LARGE",
    "IMAGE_BATCH_TOO_LARGE",
    "FILE_SIGNATURE_MISMATCH",
    "FILE_CORRUPTED",
    "PASSWORD_PROTECTED_FILE",
    "UNSAFE_FILE",
    "MALWARE_DETECTED",
    "ENCRYPTION_FAILED",
    "INVALID_ENCRYPTION_ENVELOPE",
    "UPLOAD_FAILED",
    "TRUST_ACCESS_DENIED",
    "TRUST_MEMBER_REVOKED",
    "AI_PROCESSING_DISABLED",
    "DIGILOCKER_NOT_CONFIGURED",
    "DIGILOCKER_CONSENT_INCOMPLETE",
    "DIGILOCKER_PROVIDER_ERROR",
  ]);
  const code =
    typeof candidateCode === "string" && safeCodes.has(candidateCode)
      ? candidateCode
      : status === 413
        ? "FILE_TOO_LARGE"
        : undefined;
  const validationMessage = code === "FILE_TOO_LARGE"
    ? fileTooLargeMessage(MAX_DOCUMENT_UPLOAD_BYTES)
    : code === "AI_PROCESSING_DISABLED"
      ? "AI processing is disabled for this account."
      : code === "DIGILOCKER_NOT_CONFIGURED"
        ? "DigiLocker is not configured. Contact support to enable the connection."
        : code === "DIGILOCKER_CONSENT_INCOMPLETE"
          ? "DigiLocker consent is not complete."
          : code === "DIGILOCKER_PROVIDER_ERROR"
            ? "DigiLocker is unavailable right now. Please try again."
      : code ? documentValidationMessages[code] : undefined;
  if (validationMessage || (input.error instanceof DocumentEnvelopeError && ["IMAGE_DIMENSIONS_EXCEEDED", "PDF_PAGE_LIMIT_EXCEEDED"].includes(code ?? ""))) {
    return { status, body: { code, message: validationMessage ?? (input.error as Error).message, errorId } };
  }
  // Database/provider errors may interpolate private input, even outside production.
  // Unknown metadata is never an API contract and is not safe to echo.
  return {
    status,
    body: { ...(code ? { code } : {}), message: status >= 500 ? "Internal server error." : "Request failed.", errorId },
  };
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent || res.destroyed) { res.destroy(); return; }
  const errorId = crypto.randomUUID();
  const response = buildErrorResponse({
    error,
    production: process.env.NODE_ENV === "production",
    errorId,
  });

  if (error instanceof Error) {
    console.error("Request failed", {
      errorId,
      method: req.method,
      route: req.route?.path ?? "unmatched",
      status: response.status,
      name: error.name,
      ...moduleLoadDiagnostic(error),
    });
  }

  return res.status(response.status).json(response.body);
}
