import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { getUserEntitlements } from "../services/entitlements.service";
import { decryptDocumentRecord } from "./documents.helpers";

const router = Router();
router.use(requireAuth);

function readinessFields(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const fields = value as Record<string, unknown>;
  const allowed = [
    "owner",
    "relationship",
    "verified",
    "valid",
    "status",
    "documentStatus",
    "expiresAt",
    "expiry",
    "dateOfExpiry",
    "validTill",
    "validUpto",
    "capabilities",
  ];
  return Object.fromEntries(allowed.flatMap((key) => key in fields ? [[key, fields[key]]] : []));
}

router.get("/", async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const documents = await prisma.document.findMany({
      where: { ownerProfileId: authUser.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const entitlements = await getUserEntitlements(authUser.id);

    return res.json({
      user: authUser,
      entitlements,
      familyMembers: [],
      documents: documents.map((document) => {
        const decrypted = decryptDocumentRecord(document);
        return {
          id: decrypted.id,
          title: decrypted.title,
          displayName: decrypted.displayName,
          ownerProfileId: decrypted.ownerProfileId,
          originalName: decrypted.originalName,
          mimeType: decrypted.mimeType,
          size: decrypted.size,
          documentType: decrypted.documentType,
          normalizedType: decrypted.normalizedType,
          category: decrypted.category,
          analysisSource: decrypted.analysisSource,
          confidence: decrypted.confidence,
          classificationStatus: decrypted.classificationStatus,
          classificationConfidence: decrypted.classificationConfidence,
          ownershipStatus: decrypted.ownershipStatus,
          readinessEligible: decrypted.readinessEligible,
          fields: readinessFields(decrypted.fields),
          source: decrypted.sourceProvider === "GOOGLE_DRIVE"
            ? "GOOGLE_DRIVE"
            : decrypted.sourceProvider?.toLowerCase() === "gmail" ? "GMAIL" : "MANUAL_UPLOAD",
          sourceProvider: decrypted.sourceProvider,
          driveFileId: decrypted.driveFileId,
          createdAt: decrypted.createdAt,
          updatedAt: decrypted.updatedAt,
        };
      }),
      savedPackages: [],
      version: "1",
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
