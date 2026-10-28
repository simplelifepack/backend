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

const PDF_MIME = "application/pdf";
const PAGE_SIZE = 1000;
const MAX_PDF_SIZE = 25 * 1024 * 1024;
const CONCURRENCY = 3;

export type DriveApi = drive_v3.Drive;
export type DuplicateAction = "replace" | "keep_both" | "ignore";

type DrivePdf = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  md5Checksum: string | null;
  size: number;
  webViewLink: string | null;
};


export type DriveScanResult = {
  discovered: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  indexed: number;
  updated: number;
  unchanged: number;
  ignored: number;
  duplicate: number;
  duplicate_kept: number;
  indexedCount: number;
  lastSuccessfulSync: Date;
  message: string;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const scanLogFields = new Set(["userId", "connectionId", "size", "pageSize", "pageFiles", "hasNextPage", "full", "discovered", "processed", "imported", "skipped", "failed"]);
function scanLogDetails(details: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(details).filter(([key, value]) => scanLogFields.has(key) &&
    (typeof value === "number" || typeof value === "boolean" || (["userId", "connectionId"].includes(key) && typeof value === "string"))));
}
function logDriveScan(message: string, details: Record<string, unknown> = {}) {
  console.info(`[Drive Scan] ${message}`, scanLogDetails(details));
}
function logDriveScanError(message: string, error: unknown, details: Record<string, unknown> = {}) {
  const status = (error as { response?: { status?: unknown } }).response?.status;
  console.error(`[Drive Scan] ${message}`, { ...scanLogDetails(details), ...(typeof status === "number" ? { status } : {}) });
}

function displayDriveFileName(name: string) {
  const clean = name.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "unnamed PDF";
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}


function driveFailureReason(error: unknown) {
  const status = (error as { response?: { status?: number } }).response?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `database error ${error.code}`;
  if (error instanceof Prisma.PrismaClientValidationError) return "database validation failed";
  if (status === 403) return "Google Drive denied access";
  if (status === 404) return "file was no longer available";
  if (/password/i.test(message)) return "password protected PDF";
  if (/too large|exceeds|invalid size/i.test(message)) return "file exceeds the 25 MB limit";
  if (/storage|s3|bucket|upload/i.test(message)) return "document storage failed";
  return "unsupported or unreadable PDF";
}

async function withRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      const status = (error as { response?: { status?: number } }).response?.status;
      if (![429, 500, 502, 503, 504].includes(status ?? 0) || attempt === 3) throw error;
      await wait(250 * (2 ** attempt));
    }
  }
  throw lastError;
}

export async function* listDrivePdfPages(drive: DriveApi, modifiedAfter: Date | null) {
  let pageToken: string | undefined;
  const clauses = [`mimeType = '${PDF_MIME}'`, "trashed = false"];
  if (modifiedAfter) clauses.push(`modifiedTime > '${modifiedAfter.toISOString()}'`);
  const query = clauses.join(" and ");
  logDriveScan("query", { query, pageSize: PAGE_SIZE, spaces: "drive" });
  do {
    const response = await withRetry(() => drive.files.list({
      q: query,
      spaces: "drive",
      pageSize: PAGE_SIZE,
      pageToken,
      orderBy: "modifiedTime",
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size,webViewLink)",
    }));
    const files: DrivePdf[] = [];
    for (const file of response.data.files ?? []) {
      if (!file.id || !file.name || file.mimeType !== PDF_MIME || !file.modifiedTime) continue;
      files.push({
        id: file.id,
        name: file.name,
        mimeType: PDF_MIME,
        modifiedTime: file.modifiedTime,
        md5Checksum: file.md5Checksum ?? null,
        size: Number(file.size ?? 0),
        webViewLink: file.webViewLink ?? null,
      });
    }
    yield files;
    pageToken = response.data.nextPageToken ?? undefined;
    logDriveScan("pagination", { pageFiles: response.data.files?.length ?? 0, hasNextPage: Boolean(pageToken) });
  } while (pageToken);
}

// Compatibility helper for existing callers; scanDrive consumes pages directly.
export async function listDrivePdfs(drive: DriveApi, modifiedAfter: Date | null) {
  const files: DrivePdf[] = [];
  for await (const page of listDrivePdfPages(drive, modifiedAfter)) files.push(...page);
  return files;
}

async function mapBounded<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }));
}

async function processPdf(userId: string, drive: DriveApi, file: DrivePdf, duplicateAction: DuplicateAction, forceReprocess = false) {
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

async function scanDriveWork(userId: string, options: { full?: boolean; duplicateAction?: DuplicateAction; drive?: DriveApi }) {
  logDriveScan("start", { userId, full: Boolean(options.full), duplicateAction: options.duplicateAction ?? "ignore" });
  const auth = options.drive ? null : await authorizedDrive(userId);
  const drive = options.drive ?? auth!.drive;
  const connection = auth?.connection ?? await prisma.externalConnection.findUniqueOrThrow({
    where: { userId_provider: { userId, provider: "google_drive" } },
  });
  logDriveScan("user", { userId, connectionId: connection.id });
  logDriveScan("scopes validated", { userId, scopes: connection.grantedScopes });
  if (connection.scanStartedAt) throw Object.assign(new Error("A Google Drive scan is already running."), { statusCode: 409 });
  const startedAt = new Date();
  const locked = await prisma.externalConnection.updateMany({
    where: { id: connection.id, scanStartedAt: null },
    data: { scanStartedAt: startedAt, scanPhase: "Searching Google Drive...", scanProcessed: 0, scanTotal: 0, lastScanError: null },
  });
  if (locked.count !== 1) throw Object.assign(new Error("A Google Drive scan is already running."), { statusCode: 409 });
  const counts: Record<string, number> = { indexed: 0, updated: 0, unchanged: 0, ignored: 0, duplicate: 0, duplicate_kept: 0, failed: 0 };
  let failedCount = 0;
  let completed = 0;
  try {
    const checkpoint = options.full || !connection.lastScannedAt ? null : connection.lastSuccessfulSync;
    let discovered = 0;
    for await (const files of listDrivePdfPages(drive, checkpoint)) {
    discovered += files.length;
    await prisma.externalConnection.update({ where: { id: connection.id }, data: { scanPhase: "Finding PDFs...", scanTotal: discovered } });
    await mapBounded(files, async (file) => {
      const fileName = displayDriveFileName(file.name);
      try {
        await prisma.externalConnection.update({ where: { id: connection.id }, data: { scanPhase: "Indexing PDFs..." } });
        const outcome = await processPdf(userId, drive, file, options.duplicateAction ?? "ignore", Boolean(options.full));
        counts[outcome] = (counts[outcome] ?? 0) + 1;
      } catch (error) {
        counts.failed += 1;
        const reason = driveFailureReason(error);
        failedCount += 1;
        logDriveScanError("processing failed", error, { fileId: file.id, fileName, mimeType: file.mimeType, reason });
        await markDriveDisconnectedOnAuthFailure(userId, error);
      } finally {
        completed += 1;
        await prisma.externalConnection.update({
          where: { id: connection.id },
          data: { scanProcessed: completed, scanPhase: completed >= discovered ? "Finishing..." : "Indexing..." },
        });
      }
    });
    }
    const indexedCount = await prisma.document.count({ where: { ownerProfileId: userId, sourceProvider: "GOOGLE_DRIVE" } });
    const imported = counts.indexed + counts.updated + counts.duplicate_kept;
    const skipped = counts.unchanged + counts.ignored + counts.duplicate;
    const processed = discovered;
    const message = discovered ? "Google Drive scan completed." : "0 eligible Drive files found";
    await prisma.externalConnection.update({
      where: { id: connection.id },
      data: {
        lastScannedAt: new Date(), lastSuccessfulSync: startedAt, scanStartedAt: null,
        scanPhase: null, indexedCount, lastScanError: failedCount ? `${failedCount} PDF(s) could not be processed. Please retry the scan.` : null,
      },
    });
    logDriveScan(`imported: ${imported}`, { userId });
    logDriveScan(`skipped: ${skipped}`, { userId });
    logDriveScan(`failed: ${counts.failed}`, { userId });
    logDriveScan("completed", { userId, discovered, processed, imported, skipped, failed: counts.failed });
    return {
      discovered,
      processed,
      imported,
      skipped,
      failed: counts.failed,
      indexed: counts.indexed,
      updated: counts.updated,
      unchanged: counts.unchanged,
      ignored: counts.ignored,
      duplicate: counts.duplicate,
      duplicate_kept: counts.duplicate_kept,
      indexedCount,
      lastSuccessfulSync: startedAt,
      message,
    } satisfies DriveScanResult;
  } catch (error) {
    logDriveScanError("failed", error, { userId });
    await markDriveDisconnectedOnAuthFailure(userId, error);
    await prisma.externalConnection.updateMany({
      where: { id: connection.id },
      data: { scanStartedAt: null, scanPhase: null, lastScanError: "Google Drive scan failed. Please try again." },
    });
    throw error;
  }
}
