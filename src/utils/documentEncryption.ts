import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const STRING_PREFIX = "enc:v1";
// Compatibility: existing encrypted metadata and development ciphertext depend on these legacy identifiers.
const JSON_ENVELOPE_MARKER = "__lifepackEncrypted";
const ALGORITHM = "aes-256-gcm";
const FILE_MAGIC = Buffer.from("LPENC1\n", "utf8");
const FILE_IV_LENGTH = 12;
const FILE_TAG_LENGTH = 16;

type EncryptedJsonEnvelope = {
  [JSON_ENVELOPE_MARKER]: true;
  version: 1;
  algorithm: typeof ALGORITHM;
  iv: string;
  tag: string;
  data: string;
};

let warnedAboutMissingKey = false;

function getDocumentEncryptionKey() {
  const configured = process.env.DOCUMENT_ENCRYPTION_KEY?.trim();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DOCUMENT_ENCRYPTION_KEY is required in production.");
    }

    if (!warnedAboutMissingKey) {
      warnedAboutMissingKey = true;
      console.warn("DOCUMENT_ENCRYPTION_KEY is not configured. Using a development-only fallback key.");
    }

    return createHash("sha256").update("lifepack-development-document-encryption-key").digest();
  }

  const normalized = configured.replace(/^base64:/, "").replace(/^hex:/, "");
  const decodedAsBase64 = Buffer.from(normalized, "base64");
  if (decodedAsBase64.length === 32) return decodedAsBase64;

  const decodedAsHex = Buffer.from(normalized, "hex");
  if (decodedAsHex.length === 32) return decodedAsHex;

  return createHash("sha256").update(configured).digest();
}

function keyFromEnvironment(name: string, fallback: () => Buffer) {
  const configured = process.env[name]?.trim();
  if (!configured) return fallback();
  const normalized = configured.replace(/^base64:/, "").replace(/^hex:/, "");
  const base64 = Buffer.from(normalized, "base64");
  if (base64.length === 32) return base64;
  const hex = Buffer.from(normalized, "hex");
  if (hex.length === 32) return hex;
  return createHash("sha256").update(configured).digest();
}

function getMetadataEncryptionKey() {
  return keyFromEnvironment("DOCUMENT_METADATA_ENCRYPTION_KEY", getDocumentEncryptionKey);
}

function getLookupHmacKey() {
  return keyFromEnvironment("DOCUMENT_LOOKUP_HMAC_KEY", getDocumentEncryptionKey);
}

function getDedupHmacKey() {
  return keyFromEnvironment("DOCUMENT_DEDUP_HMAC_KEY", getLookupHmacKey);
}

function encryptBytes(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getMetadataEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptBytes(input: { iv: string; tag: string; data: string }) {
  const decryptWith = (key: Buffer) => {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(input.iv, "base64"));
    decipher.setAuthTag(Buffer.from(input.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(input.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  };
  try {
    return decryptWith(getMetadataEncryptionKey());
  } catch {
    // Transitional read support for records encrypted before metadata-key separation.
    return decryptWith(getDocumentEncryptionKey());
  }
}

export function encryptString(value: string | null | undefined) {
  if (!value) return value ?? null;
  if (value.startsWith(`${STRING_PREFIX}:`)) return value;

  const encrypted = encryptBytes(value);
  return [STRING_PREFIX, encrypted.iv, encrypted.tag, encrypted.data].join(":");
}

export function decryptString(value: string | null | undefined) {
  if (!value) return value ?? null;
  if (!value.startsWith(`${STRING_PREFIX}:`)) return value;

  const [, , iv, tag, data] = value.split(":");
  if (!iv || !tag || !data) return value;

  return decryptBytes({ iv, tag, data });
}

function isEncryptedJsonEnvelope(value: unknown): value is EncryptedJsonEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Record<string, unknown>;
  return (
    envelope[JSON_ENVELOPE_MARKER] === true &&
    envelope.version === 1 &&
    envelope.algorithm === ALGORITHM &&
    typeof envelope.iv === "string" &&
    typeof envelope.tag === "string" &&
    typeof envelope.data === "string"
  );
}

export function encryptJson<T>(value: T): EncryptedJsonEnvelope {
  if (isEncryptedJsonEnvelope(value)) return value;
  const encrypted = encryptBytes(JSON.stringify(value ?? null));

  return {
    [JSON_ENVELOPE_MARKER]: true,
    version: 1,
    algorithm: ALGORITHM,
    ...encrypted,
  };
}

export function decryptJson<T>(value: unknown, fallback: T): T {
  if (!isEncryptedJsonEnvelope(value)) return (value ?? fallback) as T;

  try {
    return JSON.parse(decryptBytes(value)) as T;
  } catch {
    return fallback;
  }
}

export function documentLookupHash(value: string | null | undefined) {
  if (!value) return null;
  return createHmac("sha256", getLookupHmacKey()).update(value).digest("hex");
}

export function legacyDocumentLookupHash(value: string | null | undefined) {
  if (!value) return null;
  return createHmac("sha256", getDocumentEncryptionKey()).update(value).digest("hex");
}

export function userScopedDocumentHash(userId: string, plaintextHash: string | null | undefined) {
  if (!plaintextHash) return null;
  return createHmac("sha256", getDedupHmacKey()).update(`${userId}:${plaintextHash}`).digest("hex");
}

export function documentMetadataIntegrityHash(value: unknown) {
  return createHmac("sha256", getLookupHmacKey())
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

export function assertDocumentEncryptionConfigured() {
  const fileKey = getDocumentEncryptionKey();
  const metadataKey = getMetadataEncryptionKey();
  const lookupKey = getLookupHmacKey();
  const dedupKey = getDedupHmacKey();
  if (process.env.NODE_ENV === "production") {
    const required = [
      "DOCUMENT_ENCRYPTION_KEY",
      "DOCUMENT_METADATA_ENCRYPTION_KEY",
      "DOCUMENT_LOOKUP_HMAC_KEY",
      "DOCUMENT_DEDUP_HMAC_KEY",
    ].filter((name) => !process.env[name]?.trim());
    if (required.length) throw new Error(`${required.join(", ")} must be configured in production.`);
    const distinct = new Set([fileKey, metadataKey, lookupKey, dedupKey].map((key) => key.toString("hex")));
    if (distinct.size !== 4) throw new Error("Production document file, metadata, lookup, and deduplication keys must be distinct.");
  }
}

export async function encryptDocumentFile(sourcePath: string, destinationPath: string) {
  const iv = randomBytes(FILE_IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getDocumentEncryptionKey(), iv);
  const output = fs.createWriteStream(destinationPath, { flags: "wx" });
  output.write(Buffer.concat([FILE_MAGIC, iv]));

  await pipeline(fs.createReadStream(sourcePath), cipher, output);
  await fsp.appendFile(destinationPath, cipher.getAuthTag());
}

export function encryptDocumentBuffer(plaintext: Buffer) {
  const iv = randomBytes(FILE_IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getDocumentEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([FILE_MAGIC, iv, encrypted, cipher.getAuthTag()]);
}

export function decryptDocumentBuffer(encrypted: Buffer) {
  const headerLength = FILE_MAGIC.length + FILE_IV_LENGTH;
  const minimumLength = headerLength + FILE_TAG_LENGTH;
  if (encrypted.length <= minimumLength || !encrypted.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
    throw new Error("Encrypted document file format is unsupported.");
  }
  const iv = encrypted.subarray(FILE_MAGIC.length, headerLength);
  const tag = encrypted.subarray(encrypted.length - FILE_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getDocumentEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted.subarray(headerLength, encrypted.length - FILE_TAG_LENGTH)),
    decipher.final(),
  ]);
}

export async function createDocumentDecipher(filePath: string) {
  const stat = await fsp.stat(filePath);
  const headerLength = FILE_MAGIC.length + FILE_IV_LENGTH;
  const minimumLength = headerLength + FILE_TAG_LENGTH;
  if (stat.size <= minimumLength) {
    throw new Error("Encrypted document file is invalid.");
  }

  const handle = await fsp.open(filePath, "r");
  try {
    const header = Buffer.alloc(headerLength);
    await handle.read(header, 0, header.length, 0);
    if (!header.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
      throw new Error("Encrypted document file format is unsupported.");
    }

    const tag = Buffer.alloc(FILE_TAG_LENGTH);
    await handle.read(tag, 0, tag.length, stat.size - FILE_TAG_LENGTH);
    const iv = header.subarray(FILE_MAGIC.length);
    const decipher = createDecipheriv(ALGORITHM, getDocumentEncryptionKey(), iv);
    decipher.setAuthTag(tag);

    return {
      stream: fs.createReadStream(filePath, {
        start: headerLength,
        end: stat.size - FILE_TAG_LENGTH - 1,
      }),
      decipher,
    };
  } finally {
    await handle.close();
  }
}

export function isDocumentEncryptionEnvelope(buffer: Buffer) {
  return buffer.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);
}
