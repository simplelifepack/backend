import { decryptPrivateBytes, encryptPrivateBytes } from "../privacy/fieldEncryption";
import { withPrivateUser } from "../privacy/access";
import { prisma } from "../lib/prisma";
import { createStoredZip, sanitizeArchiveName, type ArchiveFile } from "./archiveZip";
import { readDecryptedDocumentLocation } from "./documentFileStorage";
import { getStorageProvider } from "../infrastructure/storage/createStorageProvider";
import { decryptJson, decryptString } from "../utils/documentEncryption";
import { listFullWealthRecords } from "./wealthRecords.service";
import { getUserPreferences } from "./userPreferences.service";

function exportTrust(member: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(member).filter(([field]) => !["inviteTokenHash", "invitePinHash"].includes(field)));
}

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

function jsonFile(name: string, value: unknown): ArchiveFile {
  return {
    name,
    data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    modifiedAt: new Date(),
  };
}

function csvFile(name: string, rows: Array<Record<string, unknown>>): ArchiveFile {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return {
    name,
    data: Buffer.from([columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n"), "utf8"),
    modifiedAt: new Date(),
  };
}

export async function requestAccountExport(userId: string) {
  const active = await prisma.accountExportJob.findFirst({
    where: { userId, status: { in: ["REQUESTED", "PREPARING", "READY"] }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (active) return active;
  const job = await prisma.accountExportJob.create({ data: { userId, status: "REQUESTED" } });
  setTimeout(() => { void prepareAccountExport(job.id).catch(() => undefined); }, 0);
  return job;
}

export async function getAccountExportJob(userId: string, jobId: string) {
  const job = await prisma.accountExportJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw Object.assign(new Error("Export job not found."), { statusCode: 404 });
  return job;
}

export async function downloadAccountExport(userId: string, jobId: string) {
  const job = await getAccountExportJob(userId, jobId);
  if (job.status !== "READY" || !job.storageKey || !job.fileName || !job.expiresAt || job.expiresAt <= new Date()) {
    throw Object.assign(new Error("Export is not ready."), { statusCode: 409 });
  }
  if (job.archiveEncryptionVersion !== 2) throw Object.assign(new Error("Export must be prepared again."), { statusCode: 409 });
  const stored = await getStorageProvider().download(job.storageKey);
  const data = decryptPrivateBytes(stored.toString("utf8"), { model: "AccountExportJob", recordId: job.id, ownerId: userId, field: "archive" });
  await prisma.accountExportJob.update({ where: { id: job.id }, data: { downloadedAt: new Date() } });
  return { data, fileName: job.fileName };
}

async function documentFiles(userId: string) {
  const documents = await prisma.document.findMany({
    where: { ownerProfileId: userId, deletedAt: null },
    include: { files: true },
    orderBy: { createdAt: "asc" },
  });
  const names = new Set<string>();
  const files: ArchiveFile[] = [];
  for (const document of documents) {
    const category = sanitizeArchiveName(document.category || "Other");
    const original = sanitizeArchiveName(decryptString(document.originalName) ?? document.originalName ?? "document");
    const pages = [...document.files].sort((a, b) => a.pageIndex - b.pageIndex);
    if (pages.length <= 1) {
      let name = `readiness-export/Documents/${category}/${original}`;
      let index = 2;
      while (names.has(name)) {
        name = `readiness-export/Documents/${category}/${index}-${original}`;
        index += 1;
      }
      names.add(name);
      files.push({ name, data: await readDecryptedDocumentLocation(pages[0] ?? document), modifiedAt: document.updatedAt });
      continue;
    }
    for (const page of pages) {
      const pageName = sanitizeArchiveName(decryptString(page.originalName) ?? `page-${page.pageIndex + 1}`);
      let name = `readiness-export/Documents/${category}/${original}/page-${page.pageIndex + 1}-${pageName}`;
      let index = 2;
      while (names.has(name)) {
        name = `readiness-export/Documents/${category}/${original}/${index}-page-${page.pageIndex + 1}-${pageName}`;
        index += 1;
      }
      names.add(name);
      files.push({ name, data: await readDecryptedDocumentLocation(page), modifiedAt: page.updatedAt });
    }
  }
  return { documents, files };
}

export async function prepareAccountExport(jobId: string) {
  const job = await prisma.accountExportJob.findUnique({ where: { id: jobId }, select: { id: true, userId: true, status: true } });
  if (!job || !["REQUESTED", "FAILED"].includes(job.status)) return;
  return withPrivateUser(job.userId, async () => {
  await prisma.accountExportJob.update({ where: { id: jobId }, data: { status: "PREPARING", errorMessage: null } });
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: job.userId } });
    const [{ documents, files }, healthMembers, healthRecords, measurements, medications, followUps, reminders, trustMembers, linkedTrust, preferences, wealthRecords] = await Promise.all([
      documentFiles(job.userId),
      prisma.healthMember.findMany({ where: { userId: job.userId } }),
      prisma.healthDocument.findMany({ where: { userId: job.userId } }),
      prisma.healthMeasurement.findMany({ where: { userId: job.userId } }),
      prisma.healthMedication.findMany({ where: { userId: job.userId } }),
      prisma.healthFollowUp.findMany({ where: { userId: job.userId } }),
      prisma.healthReminder.findMany({ where: { userId: job.userId } }),
      prisma.trustMember.findMany({ where: { ownerUserId: job.userId }, include: { permissions: true } }),
      prisma.trustMember.findMany({ where: { memberUserId: job.userId, status: "ACTIVE" }, include: { permissions: true } }),
      getUserPreferences(job.userId),
      listFullWealthRecords(job.userId),
    ]);
    const metadata = documents.map((document) => ({
      id: document.id,
      title: decryptString(document.title),
      originalName: decryptString(document.originalName),
      category: document.category,
      documentType: document.documentType,
      analysisSource: document.analysisSource,
      fields: decryptJson(document.fields, {}),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }));
    const exportFiles = [
      ...files,
      jsonFile("readiness-export/Account/profile.json", { id: user.id, name: user.name, email: user.email, accountTier: user.accountTier, createdAt: user.createdAt }),
      jsonFile("readiness-export/Account/preferences.json", preferences),
      jsonFile("readiness-export/Account/family-members.json", { owned: trustMembers.map(exportTrust), linked: linkedTrust.map(exportTrust) }),
      jsonFile("readiness-export/Documents/document-metadata.json", metadata),
      jsonFile("readiness-export/Health/health-data.json", { members: healthMembers, records: healthRecords, reminders }),
      csvFile("readiness-export/Health/measurements.csv", measurements),
      csvFile("readiness-export/Health/medications.csv", medications),
      csvFile("readiness-export/Health/follow-ups.csv", followUps),
      jsonFile("readiness-export/Wealth/wealth-records.json", wealthRecords),
      csvFile("readiness-export/Wealth/wealth-records.csv", wealthRecords),
      jsonFile("readiness-export/export-summary.json", { exportedAt: new Date().toISOString(), documentCount: documents.length, healthRecordCount: healthRecords.length, wealthRecordCount: wealthRecords.length }),
    ];
    const zip = (() => {
      try { return createStoredZip(exportFiles); }
      finally { exportFiles.forEach(file => file.data.fill(0)); }
    })();
    const storageKey = `${job.userId}/exports/${job.id}/readiness-export.zip`;
    try {
      const encrypted = encryptPrivateBytes(zip, { model: "AccountExportJob", recordId: job.id, ownerId: job.userId, field: "archive" });
      await getStorageProvider().upload({ key: storageKey, body: Buffer.from(encrypted), contentType: "application/octet-stream" });
    } finally { zip.fill(0); }
    await prisma.accountExportJob.update({
      where: { id: jobId },
      data: { status: "READY", storageKey, fileName: "readiness-export.zip", archiveEncryptionVersion: 2, sizeBytes: zip.length, preparedAt: new Date(), expiresAt: new Date(Date.now() + EXPORT_TTL_MS) },
    });
  } catch {
    await prisma.accountExportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMessage: "Export preparation failed." },
    }).catch(() => undefined);
  }
  });
}
