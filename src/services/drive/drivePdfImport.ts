import { readBoundedBytes } from "../boundedRead";
import { withImportAdmission } from "../../middleware/resourceLimits";
import { lockAccount, storedBytes, enforceStorage } from "../accountUsage.service";
import { queueStorageCleanup, drainStorageCleanup } from "../storageCleanup.service";
import crypto from "node:crypto";
import type { drive_v3 } from "googleapis";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createEncryptedTemporaryUpload, saveEncryptedPermanentFile, deleteTemporaryUploadFile, removePermanentFile } from "../documentFileStorage";
import { encryptDocumentOnBackend } from "../documentHybridEncryption";
import { validateDecryptedDocument, withIsolatedPlaintextFile } from "../documentSecurityValidation";
import { analyzeImportedDocument } from "../documentImportAnalysis";
import {
  documentLookupHash,
  documentMetadataIntegrityHash,
  encryptJson,
  encryptString,
  userScopedDocumentHash,
} from "../../utils/documentEncryption";
import { authorizedDrive, markDriveDisconnectedOnAuthFailure } from "./oauth";
import { type DriveApi, type DrivePdf, type DuplicateAction, logDriveScan, displayDriveFileName, MAX_PDF_SIZE, withRetry, logDriveScanError, PDF_MIME } from "./drivePdfListing";
import { scanDriveWork } from "./driveScanWork";


export async function processPdf(userId: string, drive: DriveApi, file: DrivePdf, duplicateAction: DuplicateAction, forceReprocess = false) {
  logDriveScan("processing", { fileId: file.id, fileName: displayDriveFileName(file.name), mimeType: file.mimeType, size: file.size });
  if (file.size > MAX_PDF_SIZE) {
    logDriveScan("skipped oversized", { fileId: file.id, fileName: displayDriveFileName(file.name), mimeType: file.mimeType, size: file.size });
    throw new Error("Google Drive PDF exceeds the 25 MB limit.");
  }
  const existingFile = await prisma.document.findFirst({ where: { ownerProfileId: userId, driveFileId: file.id } });
  if (!forceReprocess && existingFile && existingFile.sourceModifiedTime?.toISOString() === new Date(file.modifiedTime).toISOString()) {
    logDriveScan("skipped unchanged", { fileId: file.id, mimeType: file.mimeType });
    return "unchanged";
  }

  const response = await withRetry(() => drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "stream", timeout: 45_000 }))
    .catch((error) => {
      logDriveScanError("download failed", error, { fileId: file.id, mimeType: file.mimeType });
      throw error;
    });
  const content = await readBoundedBytes(response.data as unknown as AsyncIterable<Uint8Array>, MAX_PDF_SIZE);
  if (!content.length || content.length > MAX_PDF_SIZE) {
    logDriveScan("download invalid size", { fileId: file.id, mimeType: file.mimeType, size: content.length });
    throw new Error("Google Drive PDF is empty or exceeds the 25 MB limit.");
  }
  const plaintextHash = crypto.createHash("sha256").update(content).digest("hex");
  const checksum = userScopedDocumentHash(userId, plaintextHash)!;
  try {
    return await withIsolatedPlaintextFile(content, ".pdf", async temporaryPath => {
    const analysis = await analyzeImportedDocument(userId, { path: temporaryPath, originalName: file.name, mimeType: PDF_MIME, size: content.length });
    const uniqueNumber = analysis.validation.uniqueIdentifier;
    const duplicate = await prisma.document.findFirst({
      where: {
        ownerProfileId: userId,
        NOT: { driveFileId: file.id },
        OR: [
          { sourceChecksum: checksum },
          ...(uniqueNumber ? [{ uniqueIdentifierHash: documentLookupHash(uniqueNumber) ?? undefined }] : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    if (duplicate && duplicateAction === "ignore") {
      logDriveScan("skipped duplicate", { fileId: file.id, mimeType: file.mimeType });
      return "duplicate";
    }
    const fields = {
      ...analysis.extractedFields,
      reviewFields: analysis.reviewFields,
      warnings: analysis.warnings,
      extraction: analysis.extraction,
      uniqueIdentifier: uniqueNumber,
      uniqueIdentifierField: analysis.validation.uniqueIdentifierField,
      validatedFields: analysis.validation.validatedFields,
      documentFingerprint: analysis.validation.documentFingerprint,
      capabilities: analysis.validation.capabilities,
      driveWebViewLink: file.webViewLink ?? `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`,
    };
    const id = existingFile?.id ?? crypto.randomUUID();
    const envelope = encryptDocumentOnBackend(content, { filename: file.name, mimeType: PDF_MIME });
    await validateDecryptedDocument(content, envelope);
    const temporary = await createEncryptedTemporaryUpload(userId, envelope);
    let saved: Awaited<ReturnType<typeof saveEncryptedPermanentFile>>;
    try { saved = await saveEncryptedPermanentFile(userId, `${id}/imports/${crypto.randomUUID()}`, temporary); }
    finally {
      await deleteTemporaryUploadFile(temporary);
      await prisma.temporaryUpload.delete({ where: { id: temporary.id } });
    }
    const data = {
      ...saved,
      title: encryptString(analysis.title),
      displayName: analysis.validation.displayName,
      ownerProfileId: userId,
      targetProfileId: userId,
      uniqueIdentifier: encryptString(uniqueNumber),
      uniqueIdentifierHash: documentLookupHash(uniqueNumber),
      extractedKeyFields: encryptJson(analysis.extractedFields),
      rawText: encryptString(analysis.extractedText),
      originalName: encryptString(file.name)!,
      mimeType: PDF_MIME,
      size: content.length,
      documentType: analysis.validation.normalizedType,
      normalizedType: analysis.validation.normalizedType,
      documentTypeCode: analysis.validation.normalizedType,
      category: analysis.validation.category,
      analysisSource: analysis.analysis.analysisSource,
      confidence: analysis.confidence,
      fields: encryptJson(fields),
      metadataIntegrityHash: documentMetadataIntegrityHash(fields),
      contentHash: null,
      userScopedDedupHash: checksum,
      classificationStatus: analysis.confidence >= 70 ? "detected" : "pending",
      classificationConfidence: analysis.confidence,
      classificationSignals: analysis.analysis.evidence.map(({ label, points }) => ({ label, points })),
      ownershipStatus: "unknown",
      ownershipConfidence: 0,
      readinessEligible: false,
      integrityStatus: "pending",
      sourceProvider: "GOOGLE_DRIVE",
      sourceMessageId: file.id,
      driveFileId: file.id,
      sourceModifiedTime: new Date(file.modifiedTime),
      sourceChecksum: checksum,
      lastAnalyzed: new Date(),
    };
    let committed = false;
    try {
    await prisma.$transaction(async tx => {
      const tier = await lockAccount(tx, userId);
      enforceStorage(tier, await storedBytes(userId, tx, existingFile?.id ?? null), saved.encryptedSize);
      if (existingFile?.storageKey || existingFile?.path) await queueStorageCleanup(tx, userId, [existingFile]);
      if (duplicate && duplicateAction === "replace") {
        const replaced = await tx.document.findFirst({ where: { id: duplicate.id, ownerProfileId: userId }, include: { files: true } });
        if (replaced) {
          await queueStorageCleanup(tx, userId, [replaced, ...replaced.files]);
          await tx.document.delete({ where: { id: replaced.id } });
        }
      }
      await tx.document.upsert({
        where: { ownerProfileId_driveFileId: { ownerProfileId: userId, driveFileId: file.id } },
        create: { ...data, id }, update: data,
      });
    });
    committed = true;
    } finally { if (!committed) await removePermanentFile(saved.storageKey); }
    await drainStorageCleanup(userId);
    const outcome = duplicate ? "duplicate_kept" : existingFile ? "updated" : "indexed";
    logDriveScan("stored", { fileId: file.id, mimeType: file.mimeType, outcome });
    return outcome;
    });
  } finally {
    content.fill(0);
  }
}


export async function scanDrive(
  userId: string,
  options: { full?: boolean; duplicateAction?: DuplicateAction; drive?: DriveApi } = {},
) { return withImportAdmission(() => scanDriveWork(userId, options)); }
