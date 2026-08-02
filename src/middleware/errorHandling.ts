import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function statusCodeForError(error: unknown) {
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown };
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
  const errorId = input.errorId ?? crypto.randomUUID();
  const status = statusCodeForError(input.error);
  const candidateCode = (input.error as { code?: unknown })?.code;
  const safeCodes = new Set([
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
  ]);
  const code =
    typeof candidateCode === "string" && safeCodes.has(candidateCode)
      ? candidateCode
      : status === 413
        ? "FILE_TOO_LARGE"
        : undefined;
  if (input.production) {
    return {
      status,
      body: {
        ...(code ? { code } : {}),
        message: status === 500 ? "Internal server error." : "Request failed.",
        errorId,
      },
    };
  }

  return {
    status,
    body: {
      ...(code ? { code } : {}),
      message: input.error instanceof Error ? input.error.message : "Internal server error.",
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
      route: req.originalUrl.split("?")[0],
      status: response.status,
      name: error.name,
      message: sanitizeDiagnosticMessage(error.message),
    });
  }

  return res.status(response.status).json(response.body);
}
