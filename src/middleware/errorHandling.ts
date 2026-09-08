import { documentValidationMessages, fileTooLargeMessage } from "../services/documentValidationMessages";
import { DocumentEnvelopeError } from "../services/documentEnvelopeValidation";
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
  const safeCodes = new Set([
    "EMPTY_FILE",
    "IMAGE_DIMENSIONS_EXCEEDED",
    "PDF_PAGE_LIMIT_EXCEEDED",
    "UNSUPPORTED_FILE_TYPE",
    "FILE_TOO_LARGE",
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
  ]);
  const code =
    typeof candidateCode === "string" && safeCodes.has(candidateCode)
      ? candidateCode
      : status === 413
        ? "FILE_TOO_LARGE"
        : undefined;
  const validationMessage = code === "FILE_TOO_LARGE"
    ? fileTooLargeMessage(20 * 1024 * 1024)
    : code ? documentValidationMessages[code] : undefined;
  if (validationMessage || (input.error instanceof DocumentEnvelopeError && ["IMAGE_DIMENSIONS_EXCEEDED", "PDF_PAGE_LIMIT_EXCEEDED"].includes(code ?? ""))) {
    return { status, body: { code, message: validationMessage ?? (input.error as Error).message, errorId } };
  }
  if (input.production) {
    return {
      status,
      body: {
        ...(code ? { code } : {}),
        ...((input.error as { metadata?: unknown })?.metadata &&
        typeof (input.error as { metadata?: unknown }).metadata === "object"
          ? { metadata: (input.error as { metadata: unknown }).metadata }
          : {}),
        message: status === 500 ? "Internal server error." : "Request failed.",
        errorId,
      },
    };
  }

  return {
    status,
    body: {
      ...(code ? { code } : {}),
      ...((input.error as { metadata?: unknown })?.metadata &&
      typeof (input.error as { metadata?: unknown }).metadata === "object"
        ? { metadata: (input.error as { metadata: unknown }).metadata }
        : {}),
      message: (input.error as { name?: string })?.name === "ZodError" ? "Invalid request." : input.error instanceof Error ? input.error.message : "Internal server error.",
      errorId,
    },
  };
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
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
    });
  }

  return res.status(response.status).json(response.body);
}
