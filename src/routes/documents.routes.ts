import { queueStorageCleanup, drainStorageCleanup } from "../services/storageCleanup.service";
import { withStorageUpload, lockAccount } from "../services/accountUsage.service";
/* eslint-disable max-lines */
import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { uploadLimiter } from "../middleware/security";
import { encryptedUpload } from "../middleware/upload";
import { analyzeDocument } from "../services/documentAnalyzer";
import { ingestDocument } from "../services/ingestion/pipeline";
import { validateDocumentMetadata } from "../services/ingestion/documentDefinitions";
import {
  buildAnalyzeResponse,
  buildMinimalAIValidation,
  fallbackDocumentAIResult,
  warningCodeForAnalysisError,
} from "./documents.analysis";
import {
  buildExtractedKeyFields,
  findDuplicate,
  idSchema,
  normalizeCategory,
  saveSchema,
  toDocumentResponseDto,
} from "./documents.helpers";
import {
  documentLookupHash,
  documentMetadataIntegrityHash,
  decryptString,
  encryptJson,
  encryptString,
  userScopedDocumentHash,
} from "../utils/documentEncryption";
import {
  consumeTemporaryUpload,
  deleteTemporaryUploadFile,
  createDecryptedDocumentReadStream,
  createEncryptedTemporaryUpload,
  findOwnedTemporaryUpload,
  removePermanentFile,
  saveEncryptedPermanentFile,
} from "../services/documentFileStorage";
import {
  getPublicDocumentEncryptionKey,
  validateEncryptedDocumentEnvelope,
  validateEncryptedDocumentEnvelopes,
  verifyAndDecryptEnvelope,
} from "../services/documentHybridEncryption";
import {
  validateDecryptedDocument,
  withIsolatedPlaintextFile,
} from "../services/documentSecurityValidation";
import { normalizeNameForMatch } from "../services/identity/ownershipDetection";

function toAnalysisFile(temporaryUpload: {
  originalName: string;
  detectedMimeType: string;
  size: number;
}) {
  return {
    originalname: temporaryUpload.originalName,
    mimetype: temporaryUpload.detectedMimeType,
    size: temporaryUpload.size,
  };
}

function extensionForMimeType(mimeType: string) {
  return {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  }[mimeType] ?? ".bin";
}
const router = Router();
router.use(requireAuth);

router.get("/encryption-key", (_req, res) => {
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.json(getPublicDocumentEncryptionKey());
});

async function analyzeEncryptedUpload(
  req: Request,
  res: Response,
  next: NextFunction,
  statusCode: 200 | 202,
) {
  const plaintexts: Buffer[] = [];
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? (req.file ? [req.file] : undefined);
    const envelopes = req.body.envelopes ? validateEncryptedDocumentEnvelopes(req.body, uploadedFiles) : [validateEncryptedDocumentEnvelope(req.body, req.file)];
    for (const envelope of envelopes) { const plaintext = verifyAndDecryptEnvelope(envelope); plaintexts.push(plaintext); await validateDecryptedDocument(plaintext, envelope); }

    const duplicate = await prisma.document.findFirst({
      where: {
        ownerProfileId: authUser.id,
        userScopedDedupHash: userScopedDocumentHash(authUser.id, envelopes.map((item) => item.originalSha256).sort().join(":")),
        deletedAt: null,
      },
    });
    if (duplicate) {
      return res.status(409).json({
        code: "DUPLICATE_DOCUMENT",
        message: "Already in Readiness",
        duplicateDocument: toDocumentResponseDto(duplicate),
      });
    }

    const analyzePaths = async (index: number, paths: string[]): Promise<{ result: Awaited<ReturnType<typeof analyzeDocument>> | Error }> => index === plaintexts.length
      ? analyzeDocument(paths.map((path, i) => ({ path, originalName: envelopes[i]!.originalFilename, mimeType: envelopes[i]!.originalMimeType, size: envelopes[i]!.originalSize }))).then((result) => ({ result })).catch((error) => ({ result: error as Error }))
      : withIsolatedPlaintextFile(plaintexts[index]!, extensionForMimeType(envelopes[index]!.originalMimeType), (path) => analyzePaths(index + 1, [...paths, path]));
    const analysis = envelopes[0]!.aiAnalysisConsent ? await analyzePaths(0, []) : { result: fallbackDocumentAIResult };
    const temporaryUploads = await Promise.all(envelopes.map((envelope) => createEncryptedTemporaryUpload(authUser.id, envelope)));
    const aiResult = analysis.result instanceof Error ? fallbackDocumentAIResult : analysis.result;
    const user = await prisma.user.findUnique({ where: { id: authUser.id }, select: { name: true } });
    const ownership = !aiResult.nameOnDocument ? "unknown" : user?.name && namesReasonablyMatch(user.name, aiResult.nameOnDocument) ? "mine" : "other";
    const response = buildAnalyzeResponse({ analysis: aiResult, ownership, files: temporaryUploads.map((item) => ({ tempFileId: item.id, originalName: item.originalName, mimeType: item.detectedMimeType, size: item.size })), ...(analysis.result instanceof Error ? { warning: "Document analysis unavailable. Please review manually.", warningCode: warningCodeForAnalysisError(analysis.result) } : {}) });
    return res.status(statusCode).json(response);
  } catch (error) {
    return next(error);
  } finally {
    plaintexts.forEach((plaintext) => plaintext.fill(0));
  }
}

function namesReasonablyMatch(left: string, right: string) { const a = normalizeNameForMatch(left).split(" "); const b = normalizeNameForMatch(right).split(" "); return a.every((token) => b.some((candidate) => candidate === token || (token.length === 1 && candidate.startsWith(token)) || (candidate.length === 1 && token.startsWith(candidate)))); }

router.post("/analyze", uploadLimiter, encryptedUpload.array("encryptedFiles", 10), async (req, res, next) => {
  return analyzeEncryptedUpload(req, res, next, 200);
});
router.post("/", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const payload = saveSchema.parse(req.body);
    const pendingTemporaryUploads = await Promise.all(payload.tempFileIds.map((id) => findOwnedTemporaryUpload(authUser.id, id)));
    if (pendingTemporaryUploads.some((item) => !item)) {
      return res.status(404).json({
        code: "TEMPORARY_UPLOAD_EXPIRED",
        message: "This upload review has expired. Please select the file again.",
      });
    }
    const activeUploads = pendingTemporaryUploads.filter((item): item is NonNullable<typeof item> => Boolean(item));
    const pendingTemporaryUpload = activeUploads[0]!;
    if (activeUploads.some((item) => !item.keyAlgorithm || item.encryptedSize === null || item.scanStatus !== "passed")) {
      return res.status(422).json({ message: "Document security validation has not passed." });
    }
    const fieldsForValidation = {
      ...payload.fields,
      ...Object.fromEntries(
        payload.reviewFields
          .filter((field) => typeof field.key === "string" && typeof field.value === "string" && field.value.trim())
          .map((field) => [field.key as string, (field.value as string).trim()]),
      ),
    };
    const validation = payload.analysisSource === "ai"
      ? buildMinimalAIValidation(payload, fieldsForValidation)
      : validateDocumentMetadata({
          documentType: payload.documentType,
          rawText: payload.rawExtractedText,
          fields: fieldsForValidation,
          reviewFields: payload.reviewFields,
          confidence: payload.confidence,
          userConfirmedUnknown: payload.userConfirmedUnknown,
        });
    if (!validation.canSave) {
      return res.status(422).json({
        message: "Please review required document fields before saving.",
        validation,
      });
    }
    let duplicate = await findDuplicate(authUser.id, validation.normalizedType, validation.uniqueIdentifier);
    const userScopedDedupHash = userScopedDocumentHash(authUser.id, activeUploads.map((item) => item.contentHash).sort().join(":"));
    const contentDuplicate = userScopedDedupHash
      ? await prisma.document.findFirst({ where: { ownerProfileId: authUser.id, userScopedDedupHash, deletedAt: null } })
      : null;
    if (contentDuplicate) {
      return res.status(409).json({
        code: "DUPLICATE_DOCUMENT",
        message: "Already in Readiness",
        duplicateDocument: toDocumentResponseDto(contentDuplicate),
        actions: ["cancel"],
        validation,
      });
    }
    if (duplicate && payload.duplicateAction === "fail") {
      return res.status(409).json({
        code: "DUPLICATE_DOCUMENT",
        message: "This document already exists.",
        duplicateDocument: toDocumentResponseDto(duplicate),
        actions: ["replace", "keep_both", "cancel"],
        validation,
      });
    }
    const extractedKeyFields = buildExtractedKeyFields({
      fields: fieldsForValidation,
      validatedFields: validation.validatedFields,
      uniqueIdentifier: validation.uniqueIdentifier,
      uniqueIdentifierField: validation.uniqueIdentifierField,
    });
    const targetProfileId = payload.targetProfileId ?? authUser.id;
    const savedName = typeof fieldsForValidation.nameOnDocument === "string" ? fieldsForValidation.nameOnDocument.trim() : "";
    const user = await prisma.user.findUnique({ where: { id: authUser.id }, select: { name: true } });
    const isMine = Boolean(savedName && user?.name && namesReasonablyMatch(user.name, savedName));
    const ownership = {
      owner: !savedName ? "unknown" : isMine ? "self" : "other",
      identity: null,
      shouldCreateProfile: false,
      status: !savedName ? "unknown" as const : isMine ? "verified" as const : "mismatch" as const,
      confidence: !savedName ? 0 : isMine ? 100 : 90,
      matchedFields: isMine ? ["nameOnDocument"] : [],
      mismatchedFields: savedName && !isMine ? ["nameOnDocument"] : [],
      targetProfileId,
    };
    const newStorageKeys: string[] = [];
    const uploadedReferences: Array<Awaited<ReturnType<typeof saveEncryptedPermanentFile>>> = [];
    await drainStorageCleanup(authUser.id);
    let result;
    try {
      result = await withStorageUpload(authUser.id,
        activeUploads.reduce((total, file) => total + (file.encryptedSize ?? file.size), 0),
        duplicate && payload.duplicateAction === "replace" ? duplicate.id : null,
        async tx => {
    if (duplicate && payload.duplicateAction === "replace") duplicate = await tx.document.findUniqueOrThrow({ where: { id: duplicate.id } });
    const consumedUploads = await Promise.all(payload.tempFileIds.map((id) => consumeTemporaryUpload(authUser.id, id, tx)));
    if (consumedUploads.some((item) => !item)) {
      throw Object.assign(new Error("This upload review has expired. Please select the file again."), { statusCode: 404, code: "TEMPORARY_UPLOAD_EXPIRED" });
    }
    const storageObjectId = crypto.randomUUID();
    const documentId = duplicate && payload.duplicateAction === "replace" ? duplicate.id : storageObjectId;
    const temporaryUploads = consumedUploads.filter((item): item is NonNullable<typeof item> => Boolean(item));
    const temporaryUpload = temporaryUploads[0]!;
    const encryptedFiles: Array<Awaited<ReturnType<typeof saveEncryptedPermanentFile>>> = [];
    for (const [index, item] of temporaryUploads.entries()) {
      const file = await saveEncryptedPermanentFile(authUser.id, `${storageObjectId}/page-${index + 1}`, item, { preserveTemporaryFile: true });
      encryptedFiles.push(file);
      newStorageKeys.push(file.storageKey);
      uploadedReferences.push(file);
    }
    const encryptedFile = encryptedFiles[0]!;
    const classificationSignals = payload.evidence.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const label = (item as Record<string, unknown>).label;
      const points = (item as Record<string, unknown>).points;
      return typeof label === "string"
        ? [{ label, points: typeof points === "number" ? points : 0 }]
        : [];
    });
    const classificationStatus =
      validation.normalizedType === "unknown" || payload.confidence < 70
        ? "pending"
        : payload.verified && payload.confidence >= 90 && !validation.missingRequiredFields.length
          ? "verified"
          : "detected";
    const integrityStatus = encryptedFile.scanStatus === "passed" ? "passed" : "pending";
    const readinessEligible =
      classificationStatus === "verified" &&
      ownership.status === "verified" &&
      integrityStatus === "passed";
    const sensitiveMetadata = {
      ...fieldsForValidation,
      owner: ownership.owner,
      subType: payload.subType ?? null,
      expiry: payload.expiry ?? null,
      verified: payload.verified,
      displayName: validation.displayName,
      normalizedType: validation.normalizedType,
      reviewFields: payload.reviewFields,
      warnings: payload.warnings,
      extraction: payload.extraction,
      evidence: payload.evidence,
      uniqueIdentifier: validation.uniqueIdentifier,
      uniqueIdentifierField: validation.uniqueIdentifierField,
      validatedFields: validation.validatedFields,
      documentFingerprint: validation.documentFingerprint,
      capabilities: validation.capabilities,
    };
    const documentData = {
      id: documentId,
      originalName: encryptString(temporaryUpload.originalName)!,
      title: encryptString(payload.title ?? temporaryUpload.originalName),
      displayName: validation.displayName,
      ownerProfileId: authUser.id,
      targetProfileId,
      uniqueIdentifier: encryptString(validation.uniqueIdentifier),
      uniqueIdentifierHash: documentLookupHash(validation.uniqueIdentifier),
      extractedKeyFields: encryptJson(extractedKeyFields) as Prisma.InputJsonValue,
      rawText: encryptString(payload.rawExtractedText || null),
      storedName: encryptedFile.storedName,
      mimeType: temporaryUpload.detectedMimeType,
      size: temporaryUpload.size,
      path: encryptedFile.path,
      storageKey: encryptedFile.storageKey,
      storageBucket: encryptedFile.storageBucket,
      storageMimeType: encryptedFile.storageMimeType,
      encryptionVersion: encryptedFile.encryptionVersion,
      contentAlgorithm: encryptedFile.contentAlgorithm,
      keyAlgorithm: encryptedFile.keyAlgorithm,
      keyId: encryptedFile.keyId,
      keyVersion: encryptedFile.keyVersion,
      encryptionIv: encryptedFile.encryptionIv,
      wrappedKey: encryptedFile.wrappedKey,
      originalSha256: null,
      encryptedSha256: null,
      ciphertextHash: encryptedFile.encryptedSha256,
      encryptedSize: encryptedFile.encryptedSize,
      scanStatus: encryptedFile.scanStatus,
      scanCompletedAt: encryptedFile.scanCompletedAt,
      documentType: validation.normalizedType,
      normalizedType: validation.normalizedType,
      documentTypeCode: validation.normalizedType,
      category: validation.category || normalizeCategory(payload.category),
      analysisSource:
        payload.analysisSource === "manual"
          ? "user"
          : payload.analysisSource === "rules" && payload.extraction
            ? "hybrid"
            : payload.analysisSource,
      confidence: payload.confidence,
      classificationStatus,
      classificationConfidence: payload.confidence,
      classificationSignals: classificationSignals as Prisma.InputJsonValue,
      ownershipStatus: ownership.status,
      ownershipConfidence: ownership.confidence,
      ownershipMatchedFields: ownership.matchedFields,
      ownershipMismatchedFields: ownership.mismatchedFields,
      readinessEligible,
      integrityStatus,
      fields: encryptJson(sensitiveMetadata) as Prisma.InputJsonValue,
      metadataIntegrityHash: documentMetadataIntegrityHash(sensitiveMetadata),
      contentHash: null,
      userScopedDedupHash,
      sourceProvider: temporaryUpload.sourceProvider,
      sourceMessageId: temporaryUpload.sourceMessageId,
      sourceAttachmentId: temporaryUpload.sourceAttachmentId,
    };
    if (duplicate && payload.duplicateAction === "replace") {
      let savedDocument;
      try {
        const { id: _existingDocumentId, ...replacementData } = documentData;
        savedDocument = await tx.document.update({
          where: { id: duplicate.id },
          data: replacementData,
        });
      } catch (error) {
        await Promise.all(encryptedFiles.map((file) => removePermanentFile(file.storageKey ?? file.path)));
        throw error;
      }
      const previousFiles = await tx.documentFile.findMany({ where: { documentId: duplicate.id } });
      await queueStorageCleanup(tx, authUser.id, [duplicate, ...previousFiles]);
      await replaceDocumentFiles(tx, savedDocument.id, temporaryUploads, encryptedFiles);
      return { status: 200, body: {
        document: toDocumentResponseDto(savedDocument),
        validation,
        replaced: true,
      } };
    }
    let savedDocument;
    try {
      savedDocument = await tx.document.create({
        data: documentData,
      });
    } catch (error) {
      await Promise.all(encryptedFiles.map((file) => removePermanentFile(file.storageKey ?? file.path)));
      throw error;
    }
    if (temporaryUpload.externalCandidateId) {
      await tx.externalDocumentCandidate.updateMany({
        where: { id: temporaryUpload.externalCandidateId, userId: authUser.id },
        data: { status: "imported" },
      });
    }
    await replaceDocumentFiles(tx, savedDocument.id, temporaryUploads, encryptedFiles);
    return { status: 201, body: {
      document: toDocumentResponseDto(savedDocument),
      validation,
    } };
      });
    } catch (error) {
      const cleanup = await Promise.allSettled(newStorageKeys.map(removePermanentFile));
      const retained = uploadedReferences.filter((_file, index) => cleanup[index]?.status === "rejected");
      if (retained.length) await prisma.$transaction(tx => queueStorageCleanup(tx, authUser.id, retained.map(file => ({ ...file, size: file.encryptedSize ?? 0 }))));
      throw error;
    }
    await Promise.allSettled(activeUploads.map(deleteTemporaryUploadFile));
    await drainStorageCleanup(authUser.id);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return next(error);
  }
});

async function replaceDocumentFiles(tx: Prisma.TransactionClient, documentId: string, uploads: Array<{ originalName: string; detectedMimeType: string; size: number }>, stored: Array<Awaited<ReturnType<typeof saveEncryptedPermanentFile>>>) {
  await tx.documentFile.deleteMany({ where: { documentId } });
  await tx.documentFile.createMany({ data: stored.map((file, pageIndex) => ({ documentId, pageIndex, originalName: encryptString(uploads[pageIndex]!.originalName)!, mimeType: uploads[pageIndex]!.detectedMimeType, size: uploads[pageIndex]!.size, storageKey: file.storageKey, storedName: file.storedName, encryptionVersion: file.encryptionVersion, contentAlgorithm: file.contentAlgorithm, keyAlgorithm: file.keyAlgorithm, keyId: file.keyId, keyVersion: file.keyVersion, encryptionIv: file.encryptionIv, wrappedKey: file.wrappedKey, encryptedSize: file.encryptedSize, ciphertextHash: file.encryptedSha256 })) });
}
router.post("/upload", uploadLimiter, encryptedUpload.array("encryptedFiles", 10), async (req, res, next) => {
  return analyzeEncryptedUpload(req, res, next, 202);
});
router.get("/", async (_req, res, next) => {
  try {
    const { authUser } = _req as unknown as AuthenticatedRequest;
    const documents = await prisma.document.findMany({
      where: { ownerProfileId: authUser.id, deletedAt: null },
      orderBy: {
        createdAt: "desc",
      },
    });
    return res.json(documents.map(toDocumentResponseDto));
  } catch (error) {
    return next(error);
  }
});
router.get("/:id", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { id } = idSchema.parse(req.params);
    const document = await prisma.document.findFirst({ where: { id, ownerProfileId: authUser.id, deletedAt: null } });
    if (!document) {
      return res.status(404).json({ message: "Document not found." });
    }
    return res.json(toDocumentResponseDto(document));
  } catch (error) {
    return next(error);
  }
});
router.delete("/:id", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { id } = idSchema.parse(req.params);
    const document = await prisma.document.findFirst({ where: { id, ownerProfileId: authUser.id, deletedAt: null } });
    if (!document) {
      return res.status(404).json({ message: "Document not found." });
    }
    await prisma.$transaction(async tx => {
      await lockAccount(tx, authUser.id);
      const owned = await tx.document.findFirst({ where: { id, ownerProfileId: authUser.id }, include: { files: true } });
      if (!owned) return;
      await queueStorageCleanup(tx, authUser.id, [owned, ...owned.files]);
      await tx.document.delete({ where: { id: owned.id } });
    }, { maxWait: 30_000, timeout: 60_000 });
    await drainStorageCleanup(authUser.id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});
router.get("/:id/download", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { id } = idSchema.parse(req.params);
    const document = await prisma.document.findFirst({ where: { id, ownerProfileId: authUser.id, deletedAt: null } });
    if (!document) {
      return res.status(404).json({ message: "Document not found." });
    }
    if (document.sourceProvider === "GOOGLE_DRIVE" && document.driveFileId) {
      return res.redirect(302, `https://drive.google.com/open?id=${encodeURIComponent(document.driveFileId)}`);
    }
    res.setHeader("Content-Type", document.mimeType || "application/octet-stream");
    const safeName = decryptString(document.originalName) ?? "document";
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    const decrypted = await createDecryptedDocumentReadStream(
      document.storageKey ?? document.path,
      document.storedName,
      document,
    );
    return decrypted.pipe(res);
  } catch (error) {
    return next(error);
  }
});
router.get("/:id/preview", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { id } = idSchema.parse(req.params);
    const document = await prisma.document.findFirst({ where: { id, ownerProfileId: authUser.id, deletedAt: null } });
    if (!document) {
      return res.status(404).json({ message: "Document not found." });
    }
    if (document.sourceProvider === "GOOGLE_DRIVE" && document.driveFileId) {
      return res.redirect(302, `https://drive.google.com/open?id=${encodeURIComponent(document.driveFileId)}`);
    }
    res.setHeader("Content-Type", document.mimeType || "application/octet-stream");
    const safeName = decryptString(document.originalName) ?? "document";
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(safeName)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    const decrypted = await createDecryptedDocumentReadStream(
      document.storageKey ?? document.path,
      document.storedName,
      document,
    );
    return decrypted.pipe(res);
  } catch (error) {
    return next(error);
  }
});
export default router;
