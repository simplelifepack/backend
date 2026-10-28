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
import { type DuplicateAction, type DriveApi, logDriveScan, listDrivePdfPages, mapBounded, displayDriveFileName, driveFailureReason, logDriveScanError, type DriveScanResult } from "./drivePdfListing";
import { processPdf } from "./drivePdfImport";


export async function scanDriveWork(userId: string, options: { full?: boolean; duplicateAction?: DuplicateAction; drive?: DriveApi }) {
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
