import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { drive_v3 } from "googleapis";

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

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  do {
    const response = await withRetry(() => drive.files.list({
      q: clauses.join(" and "),
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

async function processPdf(userId: string, drive: DriveApi, file: DrivePdf, duplicateAction: DuplicateAction) {
  if (file.size > MAX_PDF_SIZE) return "failed";
  const existingFile = await prisma.document.findFirst({ where: { ownerProfileId: userId, driveFileId: file.id } });
  if (existingFile && existingFile.sourceModifiedTime?.toISOString() === new Date(file.modifiedTime).toISOString()) return "unchanged";

  const response = await withRetry(() => drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "arraybuffer" }));
  const content = Buffer.from(response.data as ArrayBuffer);
  if (!content.length || content.length > MAX_PDF_SIZE) return "failed";
  const plaintextHash = crypto.createHash("sha256").update(content).digest("hex");
  const checksum = userScopedDocumentHash(userId, plaintextHash)!;
  const temporaryPath = path.join(temporaryUploadsDir, `${crypto.randomUUID()}.pdf`);
  await fsp.writeFile(temporaryPath, content, { flag: "wx" });
  try {
    const analysis = await ingestDocument({ path: temporaryPath, originalName: file.name, mimeType: PDF_MIME, size: content.length });
    if (!analysis.success || analysis.documentType.toLowerCase() === "unknown") return "ignored";
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
    if (duplicate && duplicateAction === "ignore") return "duplicate";
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
    return duplicate ? "duplicate_kept" : existingFile ? "updated" : "indexed";
  } finally {
    await fsp.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function scanDrive(
  userId: string,
  options: { full?: boolean; duplicateAction?: DuplicateAction; drive?: DriveApi } = {},
) {
  const auth = options.drive ? null : await authorizedDrive(userId);
  const drive = options.drive ?? auth!.drive;
  const connection = auth?.connection ?? await prisma.externalConnection.findUniqueOrThrow({
    where: { userId_provider: { userId, provider: "google_drive" } },
  });
  if (connection.scanStartedAt) throw Object.assign(new Error("A Google Drive scan is already running."), { statusCode: 409 });
  const startedAt = new Date();
  const locked = await prisma.externalConnection.updateMany({
    where: { id: connection.id, scanStartedAt: null },
    data: { scanStartedAt: startedAt, scanPhase: "Searching Google Drive...", scanProcessed: 0, scanTotal: 0, lastScanError: null },
  });
  if (locked.count !== 1) throw Object.assign(new Error("A Google Drive scan is already running."), { statusCode: 409 });
  const counts: Record<string, number> = { indexed: 0, updated: 0, unchanged: 0, ignored: 0, duplicate: 0, duplicate_kept: 0, failed: 0 };
  try {
    const checkpoint = options.full ? null : connection.lastSuccessfulSync;
    const files = await listDrivePdfs(drive, checkpoint);
    await prisma.externalConnection.update({ where: { id: connection.id }, data: { scanPhase: "Finding PDFs...", scanTotal: files.length } });
    await mapBounded(files, async (file) => {
      try {
        await prisma.externalConnection.update({ where: { id: connection.id }, data: { scanPhase: "Analyzing..." } });
        const outcome = await processPdf(userId, drive, file, options.duplicateAction ?? "ignore");
        counts[outcome] = (counts[outcome] ?? 0) + 1;
      } catch (error) {
        counts.failed += 1;
        await markDriveDisconnectedOnAuthFailure(userId, error);
      } finally {
        await prisma.externalConnection.update({ where: { id: connection.id }, data: { scanProcessed: { increment: 1 }, scanPhase: "Indexing..." } });
      }
    });
    const indexedCount = await prisma.document.count({ where: { ownerProfileId: userId, sourceProvider: "GOOGLE_DRIVE" } });
    await prisma.externalConnection.update({
      where: { id: connection.id },
      data: {
        lastScannedAt: new Date(), lastSuccessfulSync: startedAt, scanStartedAt: null,
        scanPhase: null, indexedCount, lastScanError: counts.failed ? `${counts.failed} PDF(s) could not be processed.` : null,
      },
    });
    return { discovered: files.length, ...counts, indexedCount, lastSuccessfulSync: startedAt };
  } catch (error) {
    await markDriveDisconnectedOnAuthFailure(userId, error);
    await prisma.externalConnection.updateMany({
      where: { id: connection.id },
      data: { scanStartedAt: null, scanPhase: null, lastScanError: "Google Drive scan failed. Please try again." },
    });
    throw error;
  }
}
