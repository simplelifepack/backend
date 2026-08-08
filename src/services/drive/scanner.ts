import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { drive_v3 } from "googleapis";
import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { temporaryUploadsDir } from "../../middleware/upload";
import { ingestDocument } from "../ingestion/pipeline";
import { removePermanentFile } from "../documentFileStorage";
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

type DriveFailure = {
  fileId: string;
  name: string;
  reason: string;
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

function logDriveScan(message: string, details: Record<string, unknown> = {}) {
  console.info(`[Drive Scan] ${message}`, details);
}

function logDriveScanError(message: string, error: unknown, details: Record<string, unknown> = {}) {
  const status = (error as { response?: { status?: unknown } }).response?.status;
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`[Drive Scan] ${message}`, { ...details, status, error: errorMessage });
}

function displayDriveFileName(name: string) {
  const clean = name.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "unnamed PDF";
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}

function summarizeDriveFailures(failures: DriveFailure[]) {
  if (!failures.length) return null;
  const [first] = failures;
  const suffix = failures.length > 1 ? ` and ${failures.length - 1} more` : "";
  return `${failures.length} PDF(s) could not be processed: ${first.name}${suffix}. Reason: ${first.reason}`;
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

export async function listDrivePdfs(drive: DriveApi, modifiedAfter: Date | null) {
  const files: DrivePdf[] = [];
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
    pageToken = response.data.nextPageToken ?? undefined;
    logDriveScan("pagination", { pageFiles: response.data.files?.length ?? 0, hasNextPage: Boolean(pageToken) });
  } while (pageToken);
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

  const response = await withRetry(() => drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "arraybuffer" }))
    .catch((error) => {
      logDriveScanError("download failed", error, { fileId: file.id, mimeType: file.mimeType });
      throw error;
    });
  const content = Buffer.from(response.data as ArrayBuffer);
  if (!content.length || content.length > MAX_PDF_SIZE) {
    logDriveScan("download invalid size", { fileId: file.id, mimeType: file.mimeType, size: content.length });
    throw new Error("Google Drive PDF is empty or exceeds the 25 MB limit.");
  }
  const plaintextHash = crypto.createHash("sha256").update(content).digest("hex");
  const checksum = userScopedDocumentHash(userId, plaintextHash)!;
  const temporaryPath = path.join(temporaryUploadsDir, `${crypto.randomUUID()}.pdf`);
  await fsp.writeFile(temporaryPath, content, { flag: "wx" });
  try {
    const analysis = await ingestDocument({ path: temporaryPath, originalName: file.name, mimeType: PDF_MIME, size: content.length });
    if (!analysis.success || analysis.documentType.toLowerCase() === "unknown") {
      logDriveScan("skipped unsupported analysis", {
        fileId: file.id,
        fileName: displayDriveFileName(file.name),
        mimeType: file.mimeType,
        documentType: analysis.documentType,
        reason: analysis.reason,
        warningCodes: analysis.warnings.map((warning) => warning.code),
      });
      return "ignored";
    }
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
    const data = {
      title: encryptString(analysis.title),
      displayName: analysis.validation.displayName,
      ownerProfileId: userId,
      targetProfileId: userId,
      uniqueIdentifier: encryptString(uniqueNumber),
      uniqueIdentifierHash: documentLookupHash(uniqueNumber),
      extractedKeyFields: encryptJson(analysis.extractedFields),
      rawText: encryptString(analysis.extractedText),
      originalName: encryptString(file.name)!,
      storedName: "",
      mimeType: PDF_MIME,
      size: content.length,
      path: "",
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
    if (duplicate && duplicateAction === "replace") {
      await prisma.document.delete({ where: { id: duplicate.id } });
      if (duplicate.storageKey || duplicate.path) await removePermanentFile(duplicate.storageKey ?? duplicate.path);
    }
    await prisma.document.upsert({
      where: { ownerProfileId_driveFileId: { ownerProfileId: userId, driveFileId: file.id } },
      create: data,
      update: data,
    });
    const outcome = duplicate ? "duplicate_kept" : existingFile ? "updated" : "indexed";
    logDriveScan("stored", { fileId: file.id, mimeType: file.mimeType, outcome });
    return outcome;
  } finally {
    await fsp.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function scanDrive(
  userId: string,
  options: { full?: boolean; duplicateAction?: DuplicateAction; drive?: DriveApi } = {},
) {
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
  const failures: DriveFailure[] = [];
  let completed = 0;
  try {
    const checkpoint = options.full || !connection.lastScannedAt ? null : connection.lastSuccessfulSync;
    const files = await listDrivePdfs(drive, checkpoint);
    logDriveScan(`files found: ${files.length}`, { userId, checkpoint: checkpoint?.toISOString() ?? null });
    await prisma.externalConnection.update({ where: { id: connection.id }, data: { scanPhase: "Finding PDFs...", scanTotal: files.length } });
    await mapBounded(files, async (file) => {
      const fileName = displayDriveFileName(file.name);
      try {
        await prisma.externalConnection.update({ where: { id: connection.id }, data: { scanPhase: `Indexing ${fileName}` } });
        const outcome = await processPdf(userId, drive, file, options.duplicateAction ?? "ignore", Boolean(options.full));
        counts[outcome] = (counts[outcome] ?? 0) + 1;
      } catch (error) {
        counts.failed += 1;
        const reason = driveFailureReason(error);
        failures.push({ fileId: file.id, name: fileName, reason });
        logDriveScanError("processing failed", error, { fileId: file.id, fileName, mimeType: file.mimeType, reason });
        await markDriveDisconnectedOnAuthFailure(userId, error);
      } finally {
        completed += 1;
        await prisma.externalConnection.update({
          where: { id: connection.id },
          data: { scanProcessed: completed, scanPhase: completed >= files.length ? "Finishing..." : "Indexing..." },
        });
      }
    });
    const indexedCount = await prisma.document.count({ where: { ownerProfileId: userId, sourceProvider: "GOOGLE_DRIVE" } });
    const imported = counts.indexed + counts.updated + counts.duplicate_kept;
    const skipped = counts.unchanged + counts.ignored + counts.duplicate;
    const processed = files.length;
    const message = files.length ? "Google Drive scan completed." : "0 eligible Drive files found";
    await prisma.externalConnection.update({
      where: { id: connection.id },
      data: {
        lastScannedAt: new Date(), lastSuccessfulSync: startedAt, scanStartedAt: null,
        scanPhase: null, indexedCount, lastScanError: summarizeDriveFailures(failures),
      },
    });
    logDriveScan(`imported: ${imported}`, { userId });
    logDriveScan(`skipped: ${skipped}`, { userId });
    logDriveScan(`failed: ${counts.failed}`, { userId });
    logDriveScan("completed", { userId, discovered: files.length, processed, imported, skipped, failed: counts.failed });
    return {
      discovered: files.length,
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
