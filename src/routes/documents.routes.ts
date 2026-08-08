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
  buildIngestionAnalyzeResponse,
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
  createDecryptedDocumentReadStream,
  createEncryptedTemporaryUpload,
  findOwnedTemporaryUpload,
  removePermanentFile,
  saveEncryptedPermanentFile,
} from "../services/documentFileStorage";
import { createIdentityProfile, detectIdentityOwnership } from "../services/identity/ownershipDetection";
import {
  getPublicDocumentEncryptionKey,
  validateEncryptedDocumentEnvelope,
  verifyAndDecryptEnvelope,
} from "../services/documentHybridEncryption";
import {
  validateDecryptedDocument,
  withIsolatedPlaintextFile,
} from "../services/documentSecurityValidation";
import { assertStorageAllowance } from "../services/entitlements.service";

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
  let plaintext: Buffer | undefined;
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const envelope = validateEncryptedDocumentEnvelope(req.body, req.file);
    plaintext = verifyAndDecryptEnvelope(envelope);
    await validateDecryptedDocument(plaintext, envelope);
    await assertStorageAllowance(authUser.id, envelope.originalSize);

    const duplicate = await prisma.document.findFirst({
      where: {
        ownerProfileId: authUser.id,
        userScopedDedupHash: userScopedDocumentHash(authUser.id, envelope.originalSha256),
        deletedAt: null,
      },
    });
    if (duplicate) {
      return res.status(409).json({
        code: "DUPLICATE_DOCUMENT",
        message: "Already in LifePack",
        duplicateDocument: toDocumentResponseDto(duplicate),
      });
    }

    const analysis = await withIsolatedPlaintextFile(
      plaintext,
      extensionForMimeType(envelope.originalMimeType),
      async (filePath) => {
        const analysisInput = {
          path: filePath,
          originalName: envelope.originalFilename,
          mimeType: envelope.originalMimeType,
          size: envelope.originalSize,
        };
        if (!envelope.aiAnalysisConsent) {
          return {
            source: "rules" as const,
            result: await ingestDocument(analysisInput),
          };
        }
        try {
          return {
            source: "ai" as const,
            result: await analyzeDocument(analysisInput),
          };
        } catch (error) {
          return {
            source: "ai-fallback" as const,
            result: error,
          };
        }
      },
    );
    const temporaryUpload = await createEncryptedTemporaryUpload(authUser.id, envelope);
    const file = {
      originalName: temporaryUpload.originalName,
      mimeType: temporaryUpload.detectedMimeType,
      size: temporaryUpload.size,
    };
    const response = analysis.source === "rules"
      ? buildIngestionAnalyzeResponse({
          analysis: analysis.result,
          file,
          tempFileId: temporaryUpload.id,
        })
      : analysis.source === "ai"
        ? buildAnalyzeResponse({
            analysis: analysis.result,
            file: toAnalysisFile(temporaryUpload),
            tempFileId: temporaryUpload.id,
          })
        : buildAnalyzeResponse({
            analysis: fallbackDocumentAIResult,
            file: toAnalysisFile(temporaryUpload),
            tempFileId: temporaryUpload.id,
            warning: "AI analysis unavailable. Please review manually.",
            warningCode: warningCodeForAnalysisError(analysis.result),
          });
    return res.status(statusCode).json(response);
  } catch (error) {
    return next(error);
  } finally {
    plaintext?.fill(0);
  }
}

router.post("/analyze", uploadLimiter, encryptedUpload.single("encryptedFile"), async (req, res, next) => {
  return analyzeEncryptedUpload(req, res, next, 200);
});
router.post("/", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const payload = saveSchema.parse(req.body);
    const pendingTemporaryUpload = await findOwnedTemporaryUpload(authUser.id, payload.tempFileId);
    if (!pendingTemporaryUpload) {
      return res.status(404).json({
        code: "TEMPORARY_UPLOAD_EXPIRED",
        message: "This upload review has expired. Please select the file again.",
      });
    }
    if (pendingTemporaryUpload.keyAlgorithm && pendingTemporaryUpload.scanStatus !== "passed") {
      return res.status(422).json({ message: "Document security validation has not passed." });
    }
    await assertStorageAllowance(authUser.id, pendingTemporaryUpload.size);
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
    const duplicate = await findDuplicate(authUser.id, validation.normalizedType, validation.uniqueIdentifier);
    const userScopedDedupHash = userScopedDocumentHash(authUser.id, pendingTemporaryUpload.contentHash);
    const contentDuplicate = userScopedDedupHash
      ? await prisma.document.findFirst({ where: { ownerProfileId: authUser.id, userScopedDedupHash, deletedAt: null } })
      : null;
    if (contentDuplicate) {
      return res.status(409).json({
        code: "DUPLICATE_DOCUMENT",
        message: "Already in LifePack",
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
    const ownership = validation.category === "identity"
      ? await detectIdentityOwnership(authUser.id, fieldsForValidation, validation.uniqueIdentifier, payload.verified, targetProfileId)
      : {
          owner: payload.owner,
          identity: null,
          shouldCreateProfile: false,
          status: payload.verified && targetProfileId === authUser.id ? "verified" as const : "unknown" as const,
          confidence: payload.verified && targetProfileId === authUser.id ? 100 : 0,
          matchedFields: payload.verified ? ["userConfirmation"] : [],
          mismatchedFields: [],
          targetProfileId,
        };
    const temporaryUpload = await consumeTemporaryUpload(authUser.id, payload.tempFileId);
    if (!temporaryUpload) {
      return res.status(404).json({
        code: "TEMPORARY_UPLOAD_EXPIRED",
        message: "This upload review has expired. Please select the file again.",
      });
    }
    const storageObjectId = crypto.randomUUID();
    const documentId = duplicate && payload.duplicateAction === "replace" ? duplicate.id : storageObjectId;
    const encryptedFile = await saveEncryptedPermanentFile(authUser.id, storageObjectId, temporaryUpload);
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
        savedDocument = await prisma.document.update({
          where: { id: duplicate.id },
          data: replacementData,
        });
      } catch (error) {
        await removePermanentFile(encryptedFile.path);
        throw error;
      }
      await removePermanentFile(duplicate.storageKey ?? duplicate.path);
      if (ownership.identity) await createIdentityProfile(authUser.id, savedDocument.id, ownership);
      return res.status(200).json({
        document: toDocumentResponseDto(savedDocument),
        validation,
        replaced: true,
      });
    }
    let savedDocument;
    try {
      savedDocument = await prisma.document.create({
        data: documentData,
      });
    } catch (error) {
      await removePermanentFile(encryptedFile.path);
      throw error;
    }
    if (temporaryUpload.externalCandidateId) {
      await prisma.externalDocumentCandidate.updateMany({
        where: { id: temporaryUpload.externalCandidateId, userId: authUser.id },
        data: { status: "imported" },
      });
    }
    if (ownership.identity) await createIdentityProfile(authUser.id, savedDocument.id, ownership);
    return res.status(201).json({
      document: toDocumentResponseDto(savedDocument),
      validation,
    });
  } catch (error) {
    return next(error);
  }
});
router.post("/upload", uploadLimiter, encryptedUpload.single("encryptedFile"), async (req, res, next) => {
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
    await removePermanentFile(document.storageKey ?? document.path);
    await prisma.document.delete({ where: { id: document.id } });
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
