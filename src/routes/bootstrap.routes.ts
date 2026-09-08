import { drainStorageCleanup } from "../services/storageCleanup.service";
import { getAccountUsage } from "../services/accountUsage.service";
import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
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
    "documentDate",
    "statementDate",
    "issueDate",
    "date",
    "capabilities",
  ];
  return Object.fromEntries(allowed.flatMap((key) => key in fields ? [[key, fields[key]]] : []));
}

function firstString(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof fields[key] === "string" && fields[key]) return fields[key] as string;
  return null;
}

router.get("/usage", async (req, res, next) => {
  try { const id = (req as AuthenticatedRequest).authUser.id; await drainStorageCleanup(id); return res.json(await getAccountUsage(id)); } catch (error) { return next(error); }
});

router.get("/", async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const documents = await prisma.document.findMany({
      where: { ownerProfileId: authUser.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return res.json({
      user: { id: authUser.id, name: authUser.name, email: authUser.email },
      ...await getAccountUsage(authUser.id),
      familyMembers: [],
      documents: documents.map((document) => {
        const decrypted = decryptDocumentRecord(document);
        const fields = readinessFields(decrypted.fields) as Record<string, unknown>;
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
          owner: typeof fields.owner === "string" ? fields.owner : decrypted.targetProfileId === authUser.id ? "self" : "unknown",
          expiryDate: firstString(fields, ["expiry", "expiresAt", "dateOfExpiry", "validTill", "validUpto"]),
          documentDate: firstString(fields, ["documentDate", "statementDate", "issueDate", "date"]),
          capabilities: Array.isArray(fields.capabilities) ? fields.capabilities.filter((value): value is string => typeof value === "string") : [],
          readinessEligible: decrypted.readinessEligible,
          fields,
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
