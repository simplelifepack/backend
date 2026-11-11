import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { getStorageProvider } from "../infrastructure/storage/createStorageProvider";
import { decryptString } from "../utils/documentEncryption";
import { createStoredZip, sanitizeArchiveName, type ArchiveFile } from "./archiveZip";
import { DocumentStorageService } from "./DocumentStorageService";
import { readDecryptedDocumentLocation } from "./documentFileStorage";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "./documentUploadLimits";

type PacketDetails = {
  memberId: string;
  recordIds: string[];
  doctor?: string | null;
  clinic?: string | null;
  visitDate: Date | null;
};

function invalidRecords(): never {
  throw Object.assign(new Error("Choose distinct available records for this member."), { statusCode: 400 });
}

function tooLarge(): never {
  throw Object.assign(new Error("The visit packet exceeds the maximum document size. Select fewer records."), { statusCode: 413 });
}

export async function generateVisitPacket(userId: string, details: PacketDetails) {
  const records = await prisma.healthDocument.findMany({
    where: { userId, memberId: details.memberId, id: { in: details.recordIds } },
    select: { id: true, documentId: true },
  });
  if (records.length !== details.recordIds.length) invalidRecords();
  const documents = await prisma.document.findMany({
    where: { ownerProfileId: userId, deletedAt: null, id: { in: records.map(record => record.documentId) } },
    include: { files: { orderBy: { pageIndex: "asc" } } },
  });
  const byId = new Map(documents.map(document => [document.id, document]));
  const recordById = new Map(records.map(record => [record.id, record]));
  const files: ArchiveFile[] = [];
  let size = 0;
  for (const [recordIndex, recordId] of details.recordIds.entries()) {
    const record = recordById.get(recordId);
    const document = record && byId.get(record.documentId);
    if (!document) invalidRecords();
    for (const [pageIndex, file] of (document.files.length ? document.files : [document]).entries()) {
      if (size + file.size > MAX_DOCUMENT_UPLOAD_BYTES) tooLarge();
      const data = await readDecryptedDocumentLocation(file);
      size += data.length;
      if (size > MAX_DOCUMENT_UPLOAD_BYTES) tooLarge();
      const label = sanitizeArchiveName(decryptString(file.originalName) ?? "document");
      files.push({ name: [recordIndex + 1, pageIndex + 1, label].join("-"), data, modifiedAt: file.updatedAt });
    }
  }
  const archive = createStoredZip(files);
  if (archive.length > MAX_DOCUMENT_UPLOAD_BYTES) tooLarge();
  const id = randomUUID();
  const key = [userId, id, "visit-packet.zip.enc"].join("/");
  const storage = new DocumentStorageService(getStorageProvider());
  try {
    const stored = await storage.uploadEncrypted({ key, plaintext: archive });
    return await prisma.$transaction(async tx => {
      const document = await tx.document.create({ data: {
        id, ownerProfileId: userId, title: "Visit packet", displayName: "Visit packet",
        originalName: "Visit-packet.zip", storedName: "visit-packet.zip.enc", mimeType: "application/zip",
        size: archive.length, path: stored.key, storageKey: stored.key, storageBucket: stored.bucket ?? null,
        storageMimeType: "application/octet-stream", encryptionVersion: 1, encryptedSize: stored.sizeBytes,
        documentType: "Visit Packet", category: "Medical", analysisSource: "manual", confidence: 1, fields: {},
      } });
      return tx.healthVisitPacket.create({ data: { ...details, userId, fileDocumentId: document.id } });
    });
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
}
