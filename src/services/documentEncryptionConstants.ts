export const CONTENT_ALGORITHM = "AES-256-GCM" as const;
export const KEY_ALGORITHM = "RSA-OAEP-4096-SHA256" as const;
export const ENCRYPTION_VERSION = 1 as const;
export const RSA_CIPHERTEXT_BYTES = 4096 / 8;

export type DocumentEncryptionKey = {
  keyId: string;
  keyVersion: number;
  algorithm: typeof KEY_ALGORITHM;
  publicKeyPem: string;
  privateKeyPem: string;
};

export type StoredHybridEncryptionMetadata = {
  encryptionVersion: number | null;
  contentAlgorithm: string | null;
  keyAlgorithm: string | null;
  keyId: string | null;
  keyVersion: number | null;
  encryptionIv: string | null;
  wrappedKey: string | null;
  originalSha256: string | null;
  encryptedSha256: string | null;
  ciphertextHash?: string | null;
  encryptedSize: number | null;
};

export type ValidatedEncryptedEnvelope = {
  encryptionVersion: typeof ENCRYPTION_VERSION;
  contentAlgorithm: typeof CONTENT_ALGORITHM;
  keyAlgorithm: typeof KEY_ALGORITHM;
  keyId: string;
  keyVersion: number;
  iv: string;
  wrappedKey: string;
  originalFilename: string;
  originalMimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  originalSize: number;
  originalSha256: string;
  encryptedSha256: string;
  aiAnalysisConsent: boolean;
  ciphertext: Buffer;
};
