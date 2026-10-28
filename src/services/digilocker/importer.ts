import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { createEncryptedTemporaryUpload, deleteTemporaryUploadFile, saveEncryptedPermanentFile, removePermanentFile } from "../documentFileStorage";
import { encryptDocumentOnBackend } from "../documentHybridEncryption";
import { validateDecryptedDocument, withIsolatedPlaintextFile } from "../documentSecurityValidation";
import { analyzeImportedDocument } from "../documentImportAnalysis";
import { assertAIProcessingEnabled } from "../aiProcessing.service";
import { enforceStorage, lockAccount, storedBytes } from "../accountUsage.service";
import { documentLookupHash, documentMetadataIntegrityHash, encryptJson, encryptString, userScopedDocumentHash } from "../../utils/documentEncryption";
import type { LockerDocument } from "./provider";

export type ImportPhase = "Importing" | "Encrypting" | "Processing with AI" | "Completed" | "Failed";
export async function storeLockerDocument(userId: string, file: LockerDocument, content: Buffer, consent: { sessionId: string; id: string; timestamp: string; version: string }, phase: (phase: ImportPhase) => Promise<void>, lease?: { token: string; signal: AbortSignal }) {
  try {
  lease?.signal.throwIfAborted();
  const hash = userScopedDocumentHash(userId, createHash("sha256").update(content).digest("hex"))!;
  const findExisting = (db = prisma) => db.document.findFirst({ where: { ownerProfileId: userId, deletedAt: null,
    OR: [{ userScopedDedupHash: hash }, { sourceProvider: "DIGILOCKER", sourceMessageId: file.reference }] } });
  const existing = await findExisting();
  if (existing) return { documentId: existing.id, duplicate: true };
  await phase("Encrypting");
  const filename = `${file.name.replace(/[\\/\r\n]/g, "_").replace(/\.pdf$/i, "")}.pdf`;
  await validateDecryptedDocument(content, { originalFilename: filename, originalMimeType: "application/pdf", originalSize: content.length });
  const envelope = encryptDocumentOnBackend(content, { filename, mimeType: "application/pdf" });
  await prisma.$transaction(async tx => {
    const tier = await lockAccount(tx, userId);
    enforceStorage(tier, await storedBytes(userId, tx), envelope.ciphertext.length);
  });
  const temporary = await createEncryptedTemporaryUpload(userId, envelope);
  envelope.ciphertext = Buffer.alloc(0);
  let saved: Awaited<ReturnType<typeof saveEncryptedPermanentFile>> | undefined;
  let committed = false;
  try {
    const analysis = await withIsolatedPlaintextFile(content, ".pdf", path => {
      content.fill(0);
      return analyzeImportedDocument(userId,
      { path, originalName: filename, mimeType: "application/pdf", size: content.length }, {
        assertAIProcessingEnabled: async id => {
          await assertAIProcessingEnabled(id);
          await phase("Processing with AI");
        },
        analyzeDocument: async files => {
          const { getDocumentAnalyzer } = await import("../documentAnalyzer");
          const analyzer = getDocumentAnalyzer();
          lease?.signal.throwIfAborted();
          return analyzer.analyzeDocument(files, lease?.signal);
        },
      });
    });
    lease?.signal.throwIfAborted();
    const id = randomUUID();
    saved = await saveEncryptedPermanentFile(userId, `${id}/imports/${randomUUID()}`, temporary);
    const fields = { ...analysis.extractedFields, reviewFields: analysis.reviewFields, warnings: analysis.warnings,
      validation: analysis.validation, extraction: analysis.extraction,
      digilocker: { reference: file.reference, issuer: file.issuer, importedAt: new Date().toISOString(), consent, processingStatus: analysis.analysisSource === "ai" ? "completed" : "manual_review" } };
    const stored = saved;
    const result = await prisma.$transaction(async tx => {
      if (lease) {
        lease.signal.throwIfAborted();
        // This row lock serializes the document commit with cancel/expiry.
        const guard = await tx.digiLockerConsentSession.updateMany({ where: { id: consent.sessionId, userId,
          status: "IMPORTING", cancelledAt: null, expiresAt: { gt: new Date() }, importLeaseToken: lease.token,
          importLeaseUntil: { gt: new Date() } }, data: { lastCheckedAt: new Date() } });
        if (guard.count !== 1) throw new Error("Import lease ended.");
      }
      const tier = await lockAccount(tx, userId);
      const duplicate = await findExisting(tx as typeof prisma);
      if (duplicate) return { documentId: duplicate.id, duplicate: true };
      enforceStorage(tier, await storedBytes(userId, tx), stored.encryptedSize);
      const record = await tx.document.create({ data: {
        id, ...stored, ownerProfileId: userId, targetProfileId: userId,
        title: encryptString(analysis.analysisSource === "ai" ? analysis.title : file.name), displayName: analysis.validation.displayName,
        originalName: encryptString(filename)!, mimeType: "application/pdf", size: content.length,
        uniqueIdentifier: encryptString(analysis.validation.uniqueIdentifier), uniqueIdentifierHash: documentLookupHash(analysis.validation.uniqueIdentifier),
        extractedKeyFields: encryptJson(analysis.extractedFields), rawText: encryptString(analysis.extractedText),
        documentType: analysis.validation.normalizedType, normalizedType: analysis.validation.normalizedType,
        documentTypeCode: analysis.validation.normalizedType, category: analysis.validation.category,
        analysisSource: analysis.analysisSource, confidence: analysis.confidence, fields: encryptJson(fields),
        userScopedDedupHash: hash, metadataIntegrityHash: documentMetadataIntegrityHash(fields),
        classificationStatus: analysis.confidence >= 70 ? "detected" : "pending", classificationConfidence: analysis.confidence,
        ownershipStatus: "unknown", readinessEligible: false, sourceProvider: "DIGILOCKER", sourceMessageId: file.reference, lastAnalyzed: new Date(),
      } });
      // The parent storage result also has path/scan fields that DocumentFile
      // does not define. Map only supported page columns, as manual uploads do.
      await tx.documentFile.create({ data: {
        id: randomUUID(), documentId: record.id, privacyOwnerId: userId,
        pageIndex: 0, sourceType: "DIGILOCKER", originalName: encryptString(filename)!, mimeType: "application/pdf", size: content.length,
        storageKey: stored.storageKey, storedName: stored.storedName,
        storageBucket: stored.storageBucket, storageMimeType: stored.storageMimeType,
        encryptionVersion: stored.encryptionVersion, contentAlgorithm: stored.contentAlgorithm,
        keyAlgorithm: stored.keyAlgorithm, keyId: stored.keyId, keyVersion: stored.keyVersion,
        encryptionIv: stored.encryptionIv, wrappedKey: stored.wrappedKey,
        originalSha256: stored.originalSha256, encryptedSha256: stored.encryptedSha256,
        encryptedSize: stored.encryptedSize, ciphertextHash: stored.encryptedSha256,
      } });
      return { documentId: record.id, duplicate: false };
    }, { maxWait: 30_000, timeout: 60_000 });
    committed = !result.duplicate;
    return result;
  } finally {
    if (saved && !committed) await removePermanentFile(saved.storageKey);
    try { await deleteTemporaryUploadFile(temporary); }
    finally { await prisma.temporaryUpload.delete({ where: { id: temporary.id } }); }
  }
  } finally { content.fill(0); }
}
