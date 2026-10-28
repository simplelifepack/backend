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


export const PDF_MIME = "application/pdf";

export const PAGE_SIZE = 1000;

export const MAX_PDF_SIZE = 25 * 1024 * 1024;

export const CONCURRENCY = 3;


export type DriveApi = drive_v3.Drive;

export type DuplicateAction = "replace" | "keep_both" | "ignore";


export type DrivePdf = {
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


export const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));


export const scanLogFields = new Set(["userId", "connectionId", "size", "pageSize", "pageFiles", "hasNextPage", "full", "discovered", "processed", "imported", "skipped", "failed"]);

export function scanLogDetails(details: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(details).filter(([key, value]) => scanLogFields.has(key) &&
    (typeof value === "number" || typeof value === "boolean" || (["userId", "connectionId"].includes(key) && typeof value === "string"))));
}

export function logDriveScan(message: string, details: Record<string, unknown> = {}) {
  console.info(`[Drive Scan] ${message}`, scanLogDetails(details));
}

export function logDriveScanError(message: string, error: unknown, details: Record<string, unknown> = {}) {
  const status = (error as { response?: { status?: unknown } }).response?.status;
  console.error(`[Drive Scan] ${message}`, { ...scanLogDetails(details), ...(typeof status === "number" ? { status } : {}) });
}


export function displayDriveFileName(name: string) {
  const clean = name.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "unnamed PDF";
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}



export function driveFailureReason(error: unknown) {
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


export async function withRetry<T>(operation: () => Promise<T>) {
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


export async function mapBounded<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }));
}
