/* eslint-disable max-lines, no-control-regex */
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Prisma, TemporaryUpload } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { getStorageProvider } from "../infrastructure/storage/createStorageProvider";
import { DocumentStorageService } from "./DocumentStorageService";
import { permanentUploadsDir, temporaryUploadsDir, uploadsDir } from "../middleware/upload";
import {
  createDocumentDecipher,
  decryptDocumentBuffer,
} from "../utils/documentEncryption";
import {
  CONTENT_ALGORITHM,
  ENCRYPTION_VERSION,
  KEY_ALGORITHM,
  decryptHybridDocument,
  encryptDocumentOnBackend,
  isHybridEncryptionMetadata,
  type StoredHybridEncryptionMetadata,
  type ValidatedEncryptedEnvelope,
} from "./documentHybridEncryption";

const TEMP_UPLOAD_TTL_MS = 30 * 60 * 1000;
const TEMP_STATUS_ACTIVE = "active";
const TEMP_STATUS_CONSUMED = "consumed";
const ENCRYPTED_FILE_EXTENSION = ".bin";

type StoredUploadFile = {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
};

type ValidatedFile = {
  originalName: string;
  detectedMimeType: string;
  size: number;
};

class UploadValidationError extends Error {
  statusCode = 400;
}

function sanitizeFileName(input: string) {
  return (
    input
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "document"
  );
}

async function readHeader(filePath: string) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isMostlyText(buffer: Buffer) {
  if (buffer.includes(0x00)) return false;
  return buffer.every((byte) => byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e) || byte >= 0x80);
}

function detectAllowedFile(input: {
  header: Buffer;
  originalName: string;
  declaredMimeType: string;
}): string | null {
  const extension = path.extname(input.originalName).toLowerCase();
  const header = input.header;
  if (header.subarray(0, 2).toString() === "MZ") return null;
  if (input.declaredMimeType === "application/octet-stream") return null;

  const isPdf = header.subarray(0, 4).toString() === "%PDF";
  const isPng = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isWebp = header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP";
  const isBmp = header.subarray(0, 2).toString() === "BM";
  const isTiff = ["II*\u0000", "MM\u0000*"].includes(header.subarray(0, 4).toString("latin1"));
  const isZip = header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const isRtf = header.subarray(0, 5).toString("latin1") === "{\\rtf";
  const isDoc = header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const ftyp = header.subarray(4, 8).toString("latin1") === "ftyp" ? header.subarray(8, 16).toString("latin1") : "";
  const isHeic = /^hei[cx]|^hevc|^mif1|^msf1/.test(ftyp);

  if (extension === ".pdf" && input.declaredMimeType === "application/pdf" && isPdf) return "application/pdf";
  if ([".jpg", ".jpeg"].includes(extension) && input.declaredMimeType === "image/jpeg" && isJpeg) return "image/jpeg";
  if (extension === ".png" && input.declaredMimeType === "image/png" && isPng) return "image/png";
  if (extension === ".webp" && input.declaredMimeType === "image/webp" && isWebp) return "image/webp";
  if (extension === ".bmp" && input.declaredMimeType === "image/bmp" && isBmp) return "image/bmp";
  if ([".tif", ".tiff"].includes(extension) && input.declaredMimeType === "image/tiff" && isTiff) return "image/tiff";
  if ([".heic", ".heif"].includes(extension) && ["image/heic", "image/heif"].includes(input.declaredMimeType) && isHeic) return input.declaredMimeType;
  if (extension === ".docx" && input.declaredMimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && isZip) {
    return input.declaredMimeType;
  }
  if (extension === ".doc" && input.declaredMimeType === "application/msword" && isDoc) return "application/msword";
  if (extension === ".rtf" && input.declaredMimeType === "application/rtf" && isRtf) return "application/rtf";
  if (extension === ".txt" && input.declaredMimeType === "text/plain" && isMostlyText(header)) return "text/plain";

  return null;
}

async function safeUnlink(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Failed to remove upload file", { error: (error as Error).message });
    }
  }
}

async function validateUploadFile(file: StoredUploadFile): Promise<ValidatedFile> {
  const header = await readHeader(file.path);
  const detectedMimeType = detectAllowedFile({
    header,
    originalName: file.originalname,
    declaredMimeType: file.mimetype,
  });
  if (!detectedMimeType) {
    throw new UploadValidationError("Unsupported or mismatched file type.");
  }

  const stat = await fsp.stat(file.path);
  return {
    originalName: sanitizeFileName(file.originalname),
    detectedMimeType,
    size: stat.size,
  };
}

export async function createTemporaryUpload(ownerProfileId: string, file: Express.Multer.File) {
  let plaintext: Buffer | undefined;
  try {
    const validated = await validateUploadFile(file);
    plaintext = await fsp.readFile(file.path);
    // Import validation accepts additional text/office formats; envelope encryption is MIME-independent.
    const envelope = encryptDocumentOnBackend(plaintext, {
      filename: validated.originalName,
      mimeType: validated.detectedMimeType as ValidatedEncryptedEnvelope["originalMimeType"],
    });
    return await createEncryptedTemporaryUpload(ownerProfileId, envelope);
  } finally {
    plaintext?.fill(0);
    await safeUnlink(file.path);
  }
}

export async function createEncryptedTemporaryUpload(
  ownerProfileId: string,
  envelope: ValidatedEncryptedEnvelope,
) {
  await fsp.mkdir(temporaryUploadsDir, { recursive: true, mode: 0o700 });
  const id = crypto.randomUUID();
  const storagePath = path.join(temporaryUploadsDir, `${id}.bin`);
  try {
    await fsp.writeFile(storagePath, envelope.ciphertext, { flag: "wx", mode: 0o600 });
    return await prisma.temporaryUpload.create({
      data: {
        id,
        ownerProfileId,
        storagePath,
        originalName: sanitizeFileName(envelope.originalFilename),
        detectedMimeType: envelope.originalMimeType,
        size: envelope.originalSize,
        contentHash: envelope.originalSha256,
        encryptionVersion: envelope.encryptionVersion,
        contentAlgorithm: envelope.contentAlgorithm,
        keyAlgorithm: envelope.keyAlgorithm,
        keyId: envelope.keyId,
        keyVersion: envelope.keyVersion,
        encryptionIv: envelope.iv,
        wrappedKey: envelope.wrappedKey,
        originalSha256: envelope.originalSha256,
        encryptedSha256: envelope.encryptedSha256,
        encryptedSize: envelope.ciphertext.length,
        scanStatus: "passed",
        scanCompletedAt: new Date(),
        expiresAt: new Date(Date.now() + TEMP_UPLOAD_TTL_MS),
      },
    });
  } catch (error) {
    await safeUnlink(storagePath);
    throw error;
  }
}

export async function findOwnedTemporaryUpload(ownerProfileId: string, temporaryUploadId: string) {
  return prisma.temporaryUpload.findFirst({
    where: {
      id: temporaryUploadId,
      ownerProfileId,
      status: TEMP_STATUS_ACTIVE,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

export async function consumeTemporaryUpload(ownerProfileId: string, temporaryUploadId: string, db: Prisma.TransactionClient = prisma) {
  const now = new Date();
  const temporaryUpload = await db.temporaryUpload.findFirst({
    where: {
      id: temporaryUploadId,
      ownerProfileId,
      status: TEMP_STATUS_ACTIVE,
      consumedAt: null,
      expiresAt: { gt: now },
    },
  });
  if (!temporaryUpload) return null;

  const consumed = await db.temporaryUpload.updateMany({
    where: {
      id: temporaryUpload.id,
      ownerProfileId,
      status: TEMP_STATUS_ACTIVE,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      status: TEMP_STATUS_CONSUMED,
      consumedAt: now,
    },
  });

  if (consumed.count !== 1) return null;
  return { ...temporaryUpload, status: TEMP_STATUS_CONSUMED, consumedAt: now };
}

export async function deleteTemporaryUploadFile(temporaryUpload: Pick<TemporaryUpload, "storagePath">) {
  await safeUnlink(temporaryUpload.storagePath);
}

export async function saveEncryptedPermanentFile(
  ownerProfileId: string,
  documentId: string,
  temporaryUpload: TemporaryUpload,
  options: { preserveTemporaryFile?: boolean } = {},
) {
  const storageKey = `${ownerProfileId}/${documentId}/v1${ENCRYPTED_FILE_EXTENSION}`;
  try {
    const temporaryBytes = await fsp.readFile(temporaryUpload.storagePath);
    const isClientEncrypted =
      temporaryUpload.contentAlgorithm === CONTENT_ALGORITHM &&
      temporaryUpload.keyAlgorithm === KEY_ALGORITHM &&
      temporaryUpload.encryptionVersion === ENCRYPTION_VERSION &&
      temporaryUpload.keyId &&
      temporaryUpload.keyVersion &&
      temporaryUpload.encryptionIv &&
      temporaryUpload.wrappedKey &&
      temporaryUpload.originalSha256 &&
      temporaryUpload.encryptedSha256;
    const supportedMimeType = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ].includes(temporaryUpload.detectedMimeType);
    const hybrid = isClientEncrypted
      ? {
          encryptionVersion: ENCRYPTION_VERSION,
          contentAlgorithm: CONTENT_ALGORITHM,
          keyAlgorithm: KEY_ALGORITHM,
          keyId: temporaryUpload.keyId!,
          keyVersion: temporaryUpload.keyVersion!,
          iv: temporaryUpload.encryptionIv!,
          wrappedKey: temporaryUpload.wrappedKey!,
          originalSha256: temporaryUpload.originalSha256!,
          encryptedSha256: temporaryUpload.encryptedSha256!,
          ciphertext: temporaryBytes,
        }
      : supportedMimeType
        ? encryptDocumentOnBackend(temporaryBytes, {
            filename: temporaryUpload.originalName,
            mimeType: temporaryUpload.detectedMimeType as ValidatedEncryptedEnvelope["originalMimeType"],
          })
        : null;
    const storageService = new DocumentStorageService(getStorageProvider());
    const stored = hybrid
      ? await storageService.uploadCiphertext({
          key: storageKey,
          ciphertext: hybrid.ciphertext,
          metadata: {
            encryptionVersion: String(hybrid.encryptionVersion),
            contentAlgorithm: hybrid.contentAlgorithm,
            keyAlgorithm: hybrid.keyAlgorithm,
            keyId: hybrid.keyId,
            keyVersion: String(hybrid.keyVersion),
          },
        })
      : await storageService.uploadEncrypted({
          key: storageKey,
          plaintext: temporaryBytes,
        });
    if (!options.preserveTemporaryFile) await safeUnlink(temporaryUpload.storagePath);
    return {
      storageKey: stored.key,
      storageBucket: stored.bucket ?? null,
      storageMimeType: "application/octet-stream",
      encryptionVersion: hybrid?.encryptionVersion ?? 1,
      contentAlgorithm: hybrid?.contentAlgorithm ?? null,
      keyAlgorithm: hybrid?.keyAlgorithm ?? null,
      keyId: hybrid?.keyId ?? null,
      keyVersion: hybrid?.keyVersion ?? null,
      encryptionIv: hybrid?.iv ?? null,
      wrappedKey: hybrid?.wrappedKey ?? null,
      originalSha256: hybrid?.originalSha256 ?? temporaryUpload.contentHash,
      encryptedSha256: hybrid?.encryptedSha256 ?? null,
      encryptedSize: hybrid?.ciphertext.length ?? stored.sizeBytes,
      scanStatus: temporaryUpload.scanStatus ?? "passed",
      scanCompletedAt: temporaryUpload.scanCompletedAt ?? new Date(),
      storedName: path.basename(stored.key),
      path: stored.key,
    };
  } catch (error) {
    await getStorageProvider().delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function removePermanentFile(storageKeyOrPath: string | null | undefined) {
  if (!storageKeyOrPath) return;
  if (!path.isAbsolute(storageKeyOrPath)) {
    await getStorageProvider().delete(storageKeyOrPath);
    return;
  }
  const resolved = path.resolve(storageKeyOrPath);
  const permanentRoot = path.resolve(permanentUploadsDir);
  if (!resolved.startsWith(`${permanentRoot}${path.sep}`)) return;
  await safeUnlink(resolved);
}

async function readStoredDocumentBytes(
  filePath: string,
  storedName?: string,
  encryption?: StoredHybridEncryptionMetadata,
) {
  if (!path.isAbsolute(filePath)) {
    const encrypted = await getStorageProvider().download(filePath);
    if (isHybridEncryptionMetadata(encryption)) {
      if (
        encryption.encryptedSize !== null &&
        encryption.encryptedSize !== encrypted.length
      ) {
        throw new Error("Stored document size verification failed.");
      }
      const encryptedSha256 = crypto.createHash("sha256").update(encrypted).digest("hex");
      const expectedCiphertextHash = encryption.ciphertextHash ?? encryption.encryptedSha256;
      if (
        !expectedCiphertextHash ||
        !crypto.timingSafeEqual(
          Buffer.from(encryptedSha256),
          Buffer.from(expectedCiphertextHash),
        )
      ) {
        throw new Error("Stored document hash verification failed.");
      }
      const plaintext = decryptHybridDocument(encrypted, {
        keyId: encryption.keyId,
        keyVersion: encryption.keyVersion,
        iv: encryption.encryptionIv,
        wrappedKey: encryption.wrappedKey,
      });
      if (encryption.originalSha256) {
        const originalSha256 = crypto.createHash("sha256").update(plaintext).digest("hex");
        if (
          !crypto.timingSafeEqual(
            Buffer.from(originalSha256),
            Buffer.from(encryption.originalSha256),
          )
        ) {
          plaintext.fill(0);
          throw new Error("Stored document plaintext hash verification failed.");
        }
      }
      return plaintext;
    }
    return decryptDocumentBuffer(encrypted);
  }
  const resolved = path.resolve(filePath);
  const permanentRoot = path.resolve(permanentUploadsDir);
  if (resolved.startsWith(`${permanentRoot}${path.sep}`)) {
    const { stream, decipher } = await createDocumentDecipher(resolved);
    const chunks: Buffer[] = [];
    for await (const chunk of stream.pipe(decipher)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  const legacyRoot = path.resolve(uploadsDir);
  const safeStoredName = storedName && path.basename(storedName) === storedName ? storedName : null;
  const isOwnedLegacyFile =
    safeStoredName &&
    path.dirname(resolved) === legacyRoot &&
    path.basename(resolved) === safeStoredName;
  if (isOwnedLegacyFile) return fsp.readFile(resolved);

  throw new Error("Document storage path is invalid.");
}

export async function createDecryptedDocumentReadStream(
  filePath: string,
  storedName?: string,
  encryption?: StoredHybridEncryptionMetadata,
) {
  return Readable.from(await readStoredDocumentBytes(filePath, storedName, encryption));
}

export async function readDecryptedDocumentFile(
  filePath: string,
  encryption?: StoredHybridEncryptionMetadata,
) {
  return readStoredDocumentBytes(filePath, undefined, encryption);
}

export async function cleanupTemporaryUploads() {
  await fsp.mkdir(temporaryUploadsDir, { recursive: true });
  const now = new Date();
  const staleUploads = await prisma.temporaryUpload.findMany({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        { status: { not: TEMP_STATUS_ACTIVE } },
        { consumedAt: { not: null } },
      ],
    },
    take: 100,
  });

  for (const upload of staleUploads) {
    await safeUnlink(upload.storagePath);
  }

  if (staleUploads.length) {
    await prisma.temporaryUpload.deleteMany({
      where: { id: { in: staleUploads.map((upload) => upload.id) } },
    });
  }

  const known = await prisma.temporaryUpload.findMany({
    where: { status: TEMP_STATUS_ACTIVE },
    select: { storagePath: true },
  });
  const knownPaths = new Set(known.map((upload) => path.resolve(upload.storagePath)));
  const files = await fsp.readdir(temporaryUploadsDir).catch(() => []);
  for (const file of files) {
    const filePath = path.resolve(temporaryUploadsDir, file);
    if (!knownPaths.has(filePath)) {
      await safeUnlink(filePath);
    }
  }
}

export async function streamDecryptedDocumentFile(
  filePath: string,
  destination: NodeJS.WritableStream,
  encryption?: StoredHybridEncryptionMetadata,
) {
  const decrypted = await createDecryptedDocumentReadStream(filePath, undefined, encryption);
  await pipeline(decrypted, destination);
}
