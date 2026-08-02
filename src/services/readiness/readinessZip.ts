/* eslint-disable no-control-regex */
import path from "node:path";

import { prisma } from "../../lib/prisma";
import { readDecryptedDocumentFile } from "../documentFileStorage";
import { decryptString } from "../../utils/documentEncryption";
import { getReadinessForSlug } from "./readiness.service";

function decryptReadinessDocument<T extends { originalName: string; uniqueIdentifier: string | null }>(
  document: T,
): T {
  return {
    ...document,
    originalName: decryptString(document.originalName) ?? "document",
    uniqueIdentifier: decryptString(document.uniqueIdentifier),
  };
}

function sanitizeFileName(input: string) {
  return (
    input
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140) || "document"
  );
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function uint16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function createStoredZip(
  files: Array<{ name: string; data: Buffer; modifiedAt?: Date }>,
) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const modified = dosDateTime(file.modifiedAt ?? new Date());
    const checksum = crc32(file.data);
    const localHeader = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(modified.dosTime),
      uint16(modified.dosDate),
      uint32(checksum),
      uint32(file.data.length),
      uint32(file.data.length),
      uint16(name.length),
      uint16(0),
      name,
    ]);
    localParts.push(localHeader, file.data);
    centralParts.push(createCentralHeader(file.data, name, modified, checksum, offset));
    offset += localHeader.length + file.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(files.length),
    uint16(files.length),
    uint32(centralDirectory.length),
    uint32(offset),
    uint16(0),
  ]);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function createCentralHeader(
  data: Buffer,
  name: Buffer,
  modified: { dosDate: number; dosTime: number },
  checksum: number,
  offset: number,
) {
  return Buffer.concat([
    uint32(0x02014b50),
    uint16(20),
    uint16(20),
    uint16(0x0800),
    uint16(0),
    uint16(modified.dosTime),
    uint16(modified.dosDate),
    uint32(checksum),
    uint32(data.length),
    uint32(data.length),
    uint16(name.length),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(0),
    uint32(offset),
    name,
  ]);
}

export async function buildPackZip(userId: string, slug: string) {
  const readiness = await getReadinessForSlug(userId, slug);
  if (!readiness.matchedPack) return null;

  const includedSlots = readiness.groups.flatMap((group) =>
    group.requirements.filter((slot) => slot.matchedDocument).map((slot) => ({
      label: slot.label,
      document: slot.matchedDocument!,
    })),
  );
  const missingDocuments = readiness.missing.map((slot) => ({
    key: slot.key,
    label: slot.label,
    acceptedDocumentTypes: slot.acceptedDocumentTypes,
  }));
  const documentIds = [...new Set(includedSlots.map((slot) => slot.document.id))];
  const encryptedDocuments = await prisma.document.findMany({
    where: {
      ownerProfileId: userId,
      targetProfileId: userId,
      id: { in: documentIds },
      readinessEligible: true,
      classificationStatus: "verified",
      ownershipStatus: "verified",
      integrityStatus: "passed",
      deletedAt: null,
    },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      path: true,
      storageKey: true,
      encryptionVersion: true,
      contentAlgorithm: true,
      keyAlgorithm: true,
      keyId: true,
      keyVersion: true,
      encryptionIv: true,
      wrappedKey: true,
      originalSha256: true,
      encryptedSha256: true,
      ciphertextHash: true,
      encryptedSize: true,
      normalizedType: true,
      displayName: true,
      uniqueIdentifier: true,
      confidence: true,
      createdAt: true,
    },
  });
  const documents = encryptedDocuments.map(decryptReadinessDocument);
  const documentsById = new Map(documents.map((document) => [document.id, document]));

  const files: Array<{ name: string; data: Buffer; modifiedAt?: Date }> = [];
  const includedDocuments = [];
  const archivedNames = new Map<string, string>();
  for (const slot of includedSlots) {
    const document = documentsById.get(slot.document.id);
    if (!document) continue;
    let fileName = archivedNames.get(document.id);
    if (!fileName) {
      const extension = path.extname(document.originalName);
      const baseName = sanitizeFileName(
        document.normalizedType ?? document.displayName ?? document.originalName ?? "document",
      );
      fileName = `${baseName}${extension && !baseName.endsWith(extension) ? extension : ""}`;
      const data = await readDecryptedDocumentFile(document.storageKey ?? document.path, document);
      files.push({ name: fileName, data, modifiedAt: document.createdAt });
      archivedNames.set(document.id, fileName);
    }
    includedDocuments.push({
      slot: slot.label,
      documentId: document.id,
      originalName: document.originalName,
      fileName,
      normalizedType: document.normalizedType,
      displayName: document.displayName,
      uniqueIdentifier: document.uniqueIdentifier,
      confidence: document.confidence,
    });
  }

  const manifest = {
    packTitle: readiness.matchedPack.title,
    generatedAt: new Date().toISOString(),
    includedDocuments,
    missingDocuments,
  };
  files.push({
    name: "manifest.json",
    data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
  });

  return {
    fileName: `${sanitizeFileName(readiness.matchedPack.slug)}.zip`,
    zip: createStoredZip(files),
    manifest,
  };
}
