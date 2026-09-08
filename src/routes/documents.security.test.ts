import { isHybridEncryptionMetadata } from "../services/documentHybridEncryption";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { prisma } from "../lib/prisma";
import { permanentUploadsDir, temporaryUploadsDir } from "../middleware/upload";
import { buildErrorResponse } from "../middleware/errorHandling";
import {
  consumeTemporaryUpload,
  createTemporaryUpload,
  readDecryptedDocumentFile,
  removePermanentFile,
  saveEncryptedPermanentFile,
} from "../services/documentFileStorage";
import { getStorageProvider } from "../infrastructure/storage/createStorageProvider";

process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_PATH = path.join(os.tmpdir(), "readiness-document-security-storage");
import { toDocumentResponseDto } from "./documents.helpers";
import { encryptJson, encryptString } from "../utils/documentEncryption";

const ownerA = `security-owner-a-${crypto.randomUUID()}`;
const ownerB = `security-owner-b-${crypto.randomUUID()}`;

async function writeTempFixture(fileName: string, data: Buffer | string) {
  await fs.mkdir(temporaryUploadsDir, { recursive: true });
  const filePath = path.join(temporaryUploadsDir, `${crypto.randomUUID()}-${fileName}`);
  await fs.writeFile(filePath, data);
  return filePath;
}

async function createMulterFile(input: {
  fileName: string;
  mimeType: string;
  data: Buffer | string;
}) {
  const filePath = await writeTempFixture(input.fileName, input.data);
  const stat = await fs.stat(filePath);
  return {
    path: filePath,
    originalname: input.fileName,
    mimetype: input.mimeType,
    size: stat.size,
  } as Express.Multer.File;
}

async function createTextTemporaryUpload(ownerProfileId: string, text = "PAN CARD\nABCDE1234F\n") {
  const file = await createMulterFile({
    fileName: "pan.txt",
    mimeType: "text/plain",
    data: text,
  });
  return createTemporaryUpload(ownerProfileId, file);
}

async function createSavedDocument(ownerProfileId: string, content = "PAN CARD\nABCDE1234F\n") {
  const temporaryUpload = await createTextTemporaryUpload(ownerProfileId, content);
  const documentId = crypto.randomUUID();
  const encryptedFile = await saveEncryptedPermanentFile(ownerProfileId, documentId, temporaryUpload);
  const document = await prisma.document.create({
    data: {
      ...encryptedFile,
      id: documentId,
      originalName: temporaryUpload.originalName,
      title: temporaryUpload.originalName,
      displayName: "PAN Card",
      ownerProfileId,
      uniqueIdentifier: encryptString("ABCDE1234F"),
      uniqueIdentifierHash: "security-test-hash",
      extractedKeyFields: encryptJson({ uniqueIdentifier: "ABCDE1234F" }),
      rawText: encryptString(content),
      storedName: encryptedFile.storedName,
      mimeType: temporaryUpload.detectedMimeType,
      size: temporaryUpload.size,
      path: encryptedFile.path,
      storageKey: encryptedFile.storageKey,
      storageBucket: encryptedFile.storageBucket,
      encryptionVersion: encryptedFile.encryptionVersion,
      documentType: "PAN Card",
      normalizedType: "pan",
      category: "identity",
      analysisSource: "manual",
      confidence: 100,
      fields: encryptJson({ uniqueIdentifier: "ABCDE1234F" }),
    },
  });
  return { document, encryptedFile, content };
}

async function cleanup(paths: string[]) {
  await prisma.temporaryUpload.deleteMany({
    where: { ownerProfileId: { in: [ownerA, ownerB] } },
  });
  const documents = await prisma.document.findMany({
    where: { ownerProfileId: { in: [ownerA, ownerB] } },
    select: { path: true },
  });
  await prisma.document.deleteMany({
    where: { ownerProfileId: { in: [ownerA, ownerB] } },
  });
  await Promise.all(documents.map((document) => removePermanentFile(document.path)));
  await Promise.all(paths.filter((filePath) => path.isAbsolute(filePath)).map((filePath) => fs.rm(filePath, { force: true })));
}

async function run() {
  const createdPaths: string[] = [];

  try {
    await cleanup(createdPaths);

    const ownedUpload = await createTextTemporaryUpload(ownerA);
    createdPaths.push(ownedUpload.storagePath);
    assert.equal(await consumeTemporaryUpload(ownerB, ownedUpload.id), null, "User B must not consume User A's temporary upload.");
    assert.equal(await consumeTemporaryUpload(ownerA, crypto.randomUUID()), null, "Guessed temporary IDs must fail.");

    const expiredPath = await writeTempFixture("expired.txt", "expired");
    createdPaths.push(expiredPath);
    const expiredUpload = await prisma.temporaryUpload.create({
      data: {
        id: crypto.randomUUID(),
        ownerProfileId: ownerA,
        storagePath: expiredPath,
        originalName: "expired.txt",
        detectedMimeType: "text/plain",
        size: 7,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    assert.equal(await consumeTemporaryUpload(ownerA, expiredUpload.id), null, "Expired temporary uploads must not save.");

    const consumedUpload = await createTextTemporaryUpload(ownerA, "consume once");
    createdPaths.push(consumedUpload.storagePath);
    assert.ok(await consumeTemporaryUpload(ownerA, consumedUpload.id), "First consume should succeed.");
    assert.equal(await consumeTemporaryUpload(ownerA, consumedUpload.id), null, "Consumed uploads must not be reusable.");

    const { document, encryptedFile, content } = await createSavedDocument(ownerA, "secret document bytes");
    const dto = toDocumentResponseDto(document);
    assert.equal("path" in dto, false, "DTO must not expose path.");
    assert.equal("storedName" in dto, false, "DTO must not expose storedName.");
    assert.equal("uniqueIdentifierHash" in dto, false, "DTO must not expose uniqueIdentifierHash.");

    const permanentBytes = await getStorageProvider().download(encryptedFile.storageKey);
    assert.equal(permanentBytes.includes(Buffer.from(content)), false, "Permanent storage must not contain plaintext bytes.");
    assert.equal(isHybridEncryptionMetadata(document), true, "Permanent ciphertext requires persisted hybrid encryption metadata.");
    assert.equal(permanentBytes.length, document.encryptedSize);
    assert.equal((await readDecryptedDocumentFile(encryptedFile.path, document)).toString("utf8"), content);
    await assert.rejects(readDecryptedDocumentFile(encryptedFile.path, { ...document, encryptedSha256: "0".repeat(64) }), "Tampered ciphertext metadata must be rejected.");

    const ownerDocument = await prisma.document.findFirst({ where: { id: document.id, ownerProfileId: ownerA } });
    const otherUserDocument = await prisma.document.findFirst({ where: { id: document.id, ownerProfileId: ownerB } });
    assert.ok(ownerDocument, "Owner should be able to locate the document for download/preview.");
    assert.equal(otherUserDocument, null, "Another user must not locate the document for download/preview.");

    const fakePdf = await createMulterFile({
      fileName: "renamed.pdf",
      mimeType: "application/pdf",
      data: Buffer.from([0x4d, 0x5a, 0x00, 0x00]),
    });
    await assert.rejects(() => createTemporaryUpload(ownerA, fakePdf), /Unsupported or mismatched file type/);
    await assert.rejects(() => fs.stat(fakePdf.path), "Rejected temporary files should be deleted.");

    const valid = await createSavedDocument(ownerA, "valid document remains");
    const partialPath = path.join(permanentUploadsDir, `${crypto.randomUUID()}.lpe`);
    await fs.writeFile(partialPath, "partial");
    createdPaths.push(partialPath);
    await removePermanentFile(partialPath);
    assert.equal(await getStorageProvider().exists(valid.encryptedFile.storageKey), true);

    const productionError = buildErrorResponse({
      error: new Error(`${process.cwd()}/uploads/tmp/document.pdf database relation failed`),
      production: true,
      errorId: "test-error-id",
    });
    assert.deepEqual(productionError.body, {
      message: "Internal server error.",
      errorId: "test-error-id",
    });

    console.log("document security tests passed");
  } finally {
    await cleanup(createdPaths);
    await prisma.$disconnect();
  }
}

void run().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
