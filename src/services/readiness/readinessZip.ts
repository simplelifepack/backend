import path from "node:path";

import { prisma } from "../../lib/prisma";
import { readDecryptedDocumentFile } from "../documentFileStorage";
import { decryptString } from "../../utils/documentEncryption";
import { getReadinessForSlug } from "./readiness.service";
import { createStoredZip, sanitizeArchiveName } from "../archiveZip";

function decryptReadinessDocument<T extends { originalName: string; uniqueIdentifier: string | null }>(
  document: T,
): T {
  return {
    ...document,
    originalName: decryptString(document.originalName) ?? "document",
    uniqueIdentifier: decryptString(document.uniqueIdentifier),
  };
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
      const baseName = sanitizeArchiveName(
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
    fileName: `${sanitizeArchiveName(readiness.matchedPack.slug)}.zip`,
    zip: createStoredZip(files),
    manifest,
  };
}
