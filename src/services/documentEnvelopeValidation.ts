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
    super(message);
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
