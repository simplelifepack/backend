import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { getStorageProvider } from "../infrastructure/storage/createStorageProvider";
import {
  decryptJson,
  decryptString,
  documentMetadataIntegrityHash,
  encryptJson,
  encryptString,
  userScopedDocumentHash,
} from "../utils/documentEncryption";
import { normalizeDocumentType } from "../services/readiness/normalization";

const apply = process.argv.includes("--apply");

async function main() {
  const documents = await prisma.document.findMany({ orderBy: { createdAt: "asc" } });
  const summary = {
    mode: apply ? "apply" : "dry-run",
    inspected: documents.length,
    storageVerified: 0,
    storageMissingOrInvalid: 0,
    metadataEncrypted: 0,
    markedForReview: 0,
    databaseFileBodies: 0,
  };

  for (const document of documents) {
    const fields = decryptJson<Record<string, unknown>>(document.fields, {});
    const extractedKeyFields = decryptJson<Record<string, unknown> | null>(document.extractedKeyFields, null);
    let integrityStatus = document.integrityStatus;
    let ciphertextHash = document.ciphertextHash ?? document.encryptedSha256;

    if (document.storageKey) {
      try {
        const bytes = await getStorageProvider().download(document.storageKey);
        const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
        if (ciphertextHash && ciphertextHash !== actualHash) throw new Error("ciphertext hash mismatch");
        ciphertextHash = actualHash;
        integrityStatus = "passed";
        summary.storageVerified += 1;
      } catch {
        integrityStatus = "failed";
        summary.storageMissingOrInvalid += 1;
      }
    } else if (document.sourceProvider !== "GOOGLE_DRIVE") {
      integrityStatus = "pending";
      summary.storageMissingOrInvalid += 1;
    }

    const documentTypeCode = normalizeDocumentType(document.documentTypeCode ?? document.normalizedType ?? document.documentType);
    const classificationStatus = documentTypeCode === "unknown" ? "pending" : "detected";
    const userScopedDedupHash =
      document.userScopedDedupHash ??
      userScopedDocumentHash(document.ownerProfileId ?? "unowned", document.originalSha256 ?? document.contentHash);

    summary.metadataEncrypted += 1;
    summary.markedForReview += 1;
    if (!apply) continue;

    await prisma.document.update({
      where: { id: document.id },
      data: {
        originalName: encryptString(decryptString(document.originalName))!,
        title: encryptString(decryptString(document.title)),
        uniqueIdentifier: encryptString(decryptString(document.uniqueIdentifier)),
        rawText: encryptString(decryptString(document.rawText)),
        extractedKeyFields: encryptJson(extractedKeyFields),
        fields: encryptJson(fields),
        metadataIntegrityHash: documentMetadataIntegrityHash(fields),
        documentTypeCode,
        normalizedType: documentTypeCode,
        documentType: documentTypeCode,
        classificationStatus,
        classificationConfidence: Math.min(Math.max(document.confidence, 0), 100),
        ownershipStatus: "unknown",
        ownershipConfidence: 0,
        ownershipMatchedFields: [],
        ownershipMismatchedFields: [],
        readinessEligible: false,
        integrityStatus,
        ciphertextHash,
        userScopedDedupHash,
        contentHash: null,
        originalSha256: integrityStatus === "passed" ? null : document.originalSha256,
        encryptedSha256: integrityStatus === "passed" ? null : document.encryptedSha256,
      },
    });
  }

  // The current schema has no binary/blob document-body column. The encrypted
  // JSON envelopes are metadata, not a second copy of the uploaded file.
  console.log(JSON.stringify(summary, null, 2));
}

void main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Document migration failed.");
    process.exitCode = 1;
  });
