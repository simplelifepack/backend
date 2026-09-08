import { documentValidationMessages, fileTooLargeMessage } from "./documentValidationMessages";
import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";

import {
  CONTENT_ALGORITHM,
  ENCRYPTION_VERSION,
  KEY_ALGORITHM,
  RSA_CIPHERTEXT_BYTES,
  type ValidatedEncryptedEnvelope,
} from "./documentEncryptionConstants";
import { loadDocumentEncryptionKeys } from "./documentEncryptionKeyring";

const base64UrlSchema = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const envelopeFieldsSchema = z.object({
  wrappedKey: base64UrlSchema,
  iv: base64UrlSchema,
  encryptionVersion: z.coerce.number().int(),
  keyId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/),
  keyVersion: z.coerce.number().int().positive(),
  contentAlgorithm: z.literal(CONTENT_ALGORITHM),
  keyAlgorithm: z.literal(KEY_ALGORITHM),
  originalFilename: z.string().trim().min(1).max(255),
  originalMimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  originalSize: z.coerce.number().int().positive().max(20 * 1024 * 1024),
  originalSha256: sha256Schema,
  encryptedSha256: sha256Schema,
  aiAnalysisConsent: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
}).strict();

export class DocumentEnvelopeError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(documentValidationMessages[code] ?? message);
    this.name = "DocumentEnvelopeError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function decodeBase64Url(value: string, expectedBytes: number, label: string) {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== expectedBytes || bytes.toString("base64url") !== value) {
    throw new DocumentEnvelopeError("INVALID_ENCRYPTION_ENVELOPE", `${label} is invalid.`);
  }
  return bytes;
}

function hasUnsafeFilenameCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return character === "/" || character === "\\" || code < 32;
  });
}

export function validateEncryptedDocumentEnvelope(
  fields: unknown,
  file: Express.Multer.File | undefined,
): ValidatedEncryptedEnvelope {
  if (!file || file.fieldname !== "encryptedFile" || file.mimetype !== "application/octet-stream") {
    throw new DocumentEnvelopeError(
      "INVALID_ENCRYPTION_ENVELOPE",
      "An application/octet-stream encryptedFile is required.",
    );
  }
  const input = fields && typeof fields === "object" ? fields as Record<string, unknown> : {};
  if (Number(input.originalSize) > 20 * 1024 * 1024 || file.size > 20 * 1024 * 1024 + 16) {
    throw new DocumentEnvelopeError("FILE_TOO_LARGE", fileTooLargeMessage(20 * 1024 * 1024), 413);
  }
  if (Number(input.originalSize) === 0) {
    throw new DocumentEnvelopeError("EMPTY_FILE", documentValidationMessages.EMPTY_FILE!, 422);
  }
  if (typeof input.originalMimeType === "string" && !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(input.originalMimeType)) {
    throw new DocumentEnvelopeError("UNSUPPORTED_FILE_TYPE", documentValidationMessages.UNSUPPORTED_FILE_TYPE!, 415);
  }
  const parsed = envelopeFieldsSchema.safeParse(fields);
  if (!parsed.success) {
    throw new DocumentEnvelopeError(
      "INVALID_ENCRYPTION_ENVELOPE",
      "The encrypted document metadata is invalid.",
    );
  }
  if (parsed.data.encryptionVersion !== ENCRYPTION_VERSION) {
    throw new DocumentEnvelopeError("INVALID_ENCRYPTION_ENVELOPE", "Unsupported encryption version.");
  }
  if (
    parsed.data.originalFilename !== path.basename(parsed.data.originalFilename) ||
    hasUnsafeFilenameCharacter(parsed.data.originalFilename)
  ) {
    throw new DocumentEnvelopeError(
      "INVALID_ENCRYPTION_ENVELOPE",
      "The original filename is unsafe.",
    );
  }
  decodeBase64Url(parsed.data.iv, 12, "IV");
  decodeBase64Url(parsed.data.wrappedKey, RSA_CIPHERTEXT_BYTES, "Wrapped key");
  const keyExists = loadDocumentEncryptionKeys().some(
    (key) => key.keyId === parsed.data.keyId && key.keyVersion === parsed.data.keyVersion,
  );
  if (!keyExists) {
    throw new DocumentEnvelopeError(
      "INVALID_ENCRYPTION_ENVELOPE",
      "The document encryption key version is not supported.",
    );
  }
  if (file.size !== parsed.data.originalSize + 16) {
    throw new DocumentEnvelopeError(
      "INVALID_ENCRYPTION_ENVELOPE",
      "The encrypted document size is inconsistent.",
    );
  }
  const encryptedSha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(encryptedSha256), Buffer.from(parsed.data.encryptedSha256))) {
    throw new DocumentEnvelopeError(
      "INVALID_ENCRYPTION_ENVELOPE",
      "The encrypted document hash does not match.",
    );
  }
  return {
    ...parsed.data,
    encryptionVersion: ENCRYPTION_VERSION,
    ciphertext: file.buffer,
  };
}

export function validateEncryptedDocumentEnvelopes(fields: unknown, files: Express.Multer.File[] | undefined) {
  const input = fields && typeof fields === "object" ? fields as Record<string, unknown> : {};
  let metadata: unknown;
  try { metadata = JSON.parse(typeof input.envelopes === "string" ? input.envelopes : ""); } catch { metadata = null; }
  if (!Array.isArray(metadata) || !files?.length || metadata.length !== files.length || files.length > 10) {
    throw new DocumentEnvelopeError("INVALID_ENCRYPTION_ENVELOPE", "One to ten encrypted document pages are required.");
  }
  return metadata.map((item, index) => validateEncryptedDocumentEnvelope({ ...(item as object), aiAnalysisConsent: input.aiAnalysisConsent }, { ...files[index]!, fieldname: "encryptedFile" }));
}
