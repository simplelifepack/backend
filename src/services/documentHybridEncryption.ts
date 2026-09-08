import crypto from "node:crypto";

import {
  CONTENT_ALGORITHM,
  ENCRYPTION_VERSION,
  KEY_ALGORITHM,
  RSA_CIPHERTEXT_BYTES,
  type StoredHybridEncryptionMetadata,
  type ValidatedEncryptedEnvelope,
} from "./documentEncryptionConstants";
import {
  getActiveDocumentEncryptionKey,
  loadDocumentEncryptionKeys,
} from "./documentEncryptionKeyring";
import {
  decodeBase64Url,
  DocumentEnvelopeError,
} from "./documentEnvelopeValidation";

export {
  CONTENT_ALGORITHM,
  ENCRYPTION_VERSION,
  KEY_ALGORITHM,
  type StoredHybridEncryptionMetadata,
  type ValidatedEncryptedEnvelope,
} from "./documentEncryptionConstants";
export {
  getActiveDocumentEncryptionKey,
  getPublicDocumentEncryptionKey,
  loadDocumentEncryptionKeys,
  resetDocumentEncryptionKeysForTests,
} from "./documentEncryptionKeyring";
export {
  DocumentEnvelopeError,
  validateEncryptedDocumentEnvelope,
  validateEncryptedDocumentEnvelopes,
} from "./documentEnvelopeValidation";

function findKey(keyId: string, keyVersion: number) {
  const key = loadDocumentEncryptionKeys().find(
    (candidate) => candidate.keyId === keyId && candidate.keyVersion === keyVersion,
  );
  if (!key) {
    throw new DocumentEnvelopeError(
      "INVALID_ENCRYPTION_ENVELOPE",
      "The document encryption key version is not supported.",
    );
  }
  return key;
}

function unwrapAesKey(input: Pick<ValidatedEncryptedEnvelope, "keyId" | "keyVersion" | "wrappedKey">) {
  const key = findKey(input.keyId, input.keyVersion);
  try {
    const aesKey = crypto.privateDecrypt(
      {
        key: key.privateKeyPem,
        oaepHash: "sha256",
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      },
      decodeBase64Url(input.wrappedKey, RSA_CIPHERTEXT_BYTES, "Wrapped key"),
    );
    if (aesKey.length !== 32) throw new Error("Unexpected AES key length.");
    return aesKey;
  } catch {
    throw new DocumentEnvelopeError(
      "INVALID_ENCRYPTION_ENVELOPE",
      "The encrypted document key could not be verified.",
    );
  }
}

export function decryptHybridDocument(
  ciphertext: Buffer,
  metadata: Pick<ValidatedEncryptedEnvelope, "keyId" | "keyVersion" | "wrappedKey" | "iv">,
) {
  const aesKey = unwrapAesKey(metadata);
  try {
    if (ciphertext.length < 17) throw new Error("Ciphertext is truncated.");
    const tag = ciphertext.subarray(ciphertext.length - 16);
    const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      aesKey,
      decodeBase64Url(metadata.iv, 12, "IV"),
      { authTagLength: 16 },
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw new DocumentEnvelopeError(
      "INVALID_ENCRYPTION_ENVELOPE",
      "The encrypted document failed authentication.",
    );
  } finally {
    aesKey.fill(0);
  }
}

export function verifyAndDecryptEnvelope(envelope: ValidatedEncryptedEnvelope) {
  const plaintext = decryptHybridDocument(envelope.ciphertext, envelope);
  const originalSha256 = crypto.createHash("sha256").update(plaintext).digest("hex");
  if (
    plaintext.length !== envelope.originalSize ||
    !crypto.timingSafeEqual(Buffer.from(originalSha256), Buffer.from(envelope.originalSha256))
  ) {
    plaintext.fill(0);
    throw new DocumentEnvelopeError(
      "INVALID_ENCRYPTION_ENVELOPE",
      "The decrypted document does not match its authenticated metadata.",
    );
  }
  return plaintext;
}

export function encryptDocumentOnBackend(
  plaintext: Buffer,
  originalMetadata: { filename: string; mimeType: ValidatedEncryptedEnvelope["originalMimeType"] },
) {
  const key = getActiveDocumentEncryptionKey();
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv, { authTagLength: 16 });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    const wrappedKey = crypto.publicEncrypt(
      {
        key: key.publicKeyPem,
        oaepHash: "sha256",
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      },
      aesKey,
    );
    return {
      encryptionVersion: ENCRYPTION_VERSION,
      contentAlgorithm: CONTENT_ALGORITHM,
      keyAlgorithm: KEY_ALGORITHM,
      keyId: key.keyId,
      keyVersion: key.keyVersion,
      iv: iv.toString("base64url"),
      wrappedKey: wrappedKey.toString("base64url"),
      originalFilename: originalMetadata.filename,
      originalMimeType: originalMetadata.mimeType,
      originalSize: plaintext.length,
      originalSha256: crypto.createHash("sha256").update(plaintext).digest("hex"),
      encryptedSha256: crypto.createHash("sha256").update(ciphertext).digest("hex"),
      aiAnalysisConsent: false,
      ciphertext,
    } satisfies ValidatedEncryptedEnvelope;
  } finally {
    aesKey.fill(0);
  }
}

export function rewrapDocumentAesKey(input: {
  keyId: string;
  keyVersion: number;
  wrappedKey: string;
}) {
  const aesKey = unwrapAesKey(input);
  try {
    const active = getActiveDocumentEncryptionKey();
    const wrappedKey = crypto.publicEncrypt(
      {
        key: active.publicKeyPem,
        oaepHash: "sha256",
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      },
      aesKey,
    );
    return {
      wrappedKey: wrappedKey.toString("base64url"),
      keyId: active.keyId,
      keyVersion: active.keyVersion,
      keyAlgorithm: KEY_ALGORITHM,
    };
  } finally {
    aesKey.fill(0);
  }
}

export function isHybridEncryptionMetadata(
  metadata: StoredHybridEncryptionMetadata | null | undefined,
): metadata is StoredHybridEncryptionMetadata & {
  keyId: string;
  keyVersion: number;
  encryptionIv: string;
    wrappedKey: string;
  } {
  return Boolean(
    metadata?.encryptionVersion === ENCRYPTION_VERSION &&
    metadata.contentAlgorithm === CONTENT_ALGORITHM &&
    metadata.keyAlgorithm === KEY_ALGORITHM &&
    metadata.keyId &&
    metadata.keyVersion &&
    metadata.encryptionIv &&
    metadata.wrappedKey &&
    (metadata.encryptedSha256 || metadata.ciphertextHash),
  );
}
