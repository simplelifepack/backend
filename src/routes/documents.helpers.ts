import type { Document } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { validateDocumentMetadata } from "../services/ingestion/documentDefinitions";
import {
  decryptJson,
  decryptString,
  documentLookupHash,
  legacyDocumentLookupHash,
} from "../utils/documentEncryption";

export const idSchema = z.object({
  id: z.string().min(1),
});

export const saveSchema = z.object({
  tempFileId: z.string().uuid(),
  originalName: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  size: z.coerce.number().int().nonnegative().optional(),
  title: z.string().trim().min(1).optional(),
  category: z.string().min(1),
  documentType: z.string().min(1),
  confidence: z.coerce.number().min(0).max(100),
  fields: z.record(z.unknown()).default({}),
  reviewFields: z.array(z.record(z.unknown())).default([]),
  rawExtractedText: z.string().default(""),
  warnings: z.array(z.unknown()).default([]),
  extraction: z.record(z.unknown()).optional(),
  evidence: z.array(z.unknown()).default([]),
  analysisSource: z.enum(["rules", "manual", "ai"]).default("rules"),
  duplicateAction: z.enum(["fail", "replace", "keep_both"]).default("fail"),
  userConfirmedUnknown: z.boolean().default(false),
  owner: z.enum(["self", "spouse", "father", "mother", "child", "seller", "buyer", "employer", "bank", "hospital", "government", "other", "unknown"]).default("self"),
  subType: z.string().trim().min(1).nullable().optional(),
  expiry: z.string().trim().min(1).nullable().optional(),
  verified: z.boolean().default(false),
  targetProfileId: z.string().min(1).optional(),
});

const categoryMap: Record<string, string> = {
  Identity: "identity",
  Employment: "employment",
  Finance: "finance",
  Insurance: "insurance",
  Property: "property",
  Medical: "medical",
  Education: "education",
  Travel: "travel",
  Vehicle: "vehicle",
  Legal: "legal",
  Photo: "photo",
  Other: "other",
};

export function normalizeCategory(value: string) {
  const trimmed = value.trim();
  return (
    categoryMap[trimmed] ??
    (trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ||
      "other")
  );
}

type EncryptedDocumentRecord = {
  originalName?: string;
  title?: string | null;
  uniqueIdentifier?: string | null;
  extractedKeyFields?: unknown;
  rawText?: string | null;
  fields?: unknown;
};

export function decryptDocumentRecord<T extends EncryptedDocumentRecord>(document: T): T {
  return {
    ...document,
    originalName: decryptString(document.originalName) ?? document.originalName,
    title: decryptString(document.title),
    uniqueIdentifier: decryptString(document.uniqueIdentifier),
    rawText: decryptString(document.rawText),
    extractedKeyFields: decryptJson(document.extractedKeyFields, null),
    fields: decryptJson<Record<string, unknown>>(document.fields, {}),
  };
}

export type DocumentResponseDto = {
  id: string;
  ownerProfileId: string | null;
  title: string | null;
  displayName: string | null;
  uniqueIdentifier: string | null;
  extractedKeyFields: unknown;
  rawText: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  documentType: string;
  normalizedType: string | null;
  category: string;
  analysisSource: string;
  confidence: number;
  classificationStatus: string;
  classificationConfidence: number;
  ownershipStatus: string;
  readinessEligible: boolean;
  fields: Record<string, unknown>;
  source: "MANUAL_UPLOAD" | "GMAIL" | "GOOGLE_DRIVE";
  sourceProvider: string | null;
  driveFileId: string | null;
  openUrl: string | null;
  lastAnalyzed: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toDocumentResponseDto(document: Document): DocumentResponseDto {
  const decrypted = decryptDocumentRecord(document);
  const source = decrypted.sourceProvider === "GOOGLE_DRIVE"
    ? "GOOGLE_DRIVE"
    : decrypted.sourceProvider?.toLowerCase() === "gmail" ? "GMAIL" : "MANUAL_UPLOAD";
  return {
    id: decrypted.id,
    ownerProfileId: decrypted.ownerProfileId,
    title: decrypted.title,
    displayName: decrypted.displayName,
    uniqueIdentifier: decrypted.uniqueIdentifier,
    extractedKeyFields: decrypted.extractedKeyFields,
    rawText: decrypted.rawText,
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
    fields: (decrypted.fields ?? {}) as Record<string, unknown>,
    source,
    sourceProvider: decrypted.sourceProvider,
    driveFileId: decrypted.driveFileId,
    openUrl: decrypted.driveFileId ? `https://drive.google.com/open?id=${encodeURIComponent(decrypted.driveFileId)}` : null,
    lastAnalyzed: decrypted.lastAnalyzed,
    createdAt: decrypted.createdAt,
    updatedAt: decrypted.updatedAt,
  };
}

export function buildExtractedKeyFields(input: {
  fields: Record<string, unknown>;
  validatedFields: ReturnType<typeof validateDocumentMetadata>["validatedFields"];
  uniqueIdentifier: string | null;
  uniqueIdentifierField: string;
}) {
  const keyFields: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(input.validatedFields)) {
    if (field.value) keyFields[key] = field.value;
  }
  for (const [key, value] of Object.entries(input.fields)) {
    if (value === undefined || value === null || key in keyFields) continue;
    if (["reviewFields", "warnings", "extraction", "evidence", "rawExtractedText"].includes(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      keyFields[key] = value;
    }
  }
  if (input.uniqueIdentifier) {
    keyFields.uniqueIdentifier = input.uniqueIdentifier;
    keyFields.uniqueIdentifierField = input.uniqueIdentifierField;
  }
  return keyFields;
}

export async function findDuplicate(
  ownerProfileId: string,
  normalizedType: string,
  uniqueIdentifier: string | null,
) {
  if (!uniqueIdentifier) return null;
  const uniqueIdentifierHash = documentLookupHash(uniqueIdentifier);
  const legacyUniqueIdentifierHash = legacyDocumentLookupHash(uniqueIdentifier);
  return prisma.document.findFirst({
    where: {
      ownerProfileId,
      normalizedType,
      OR: [
        ...(uniqueIdentifierHash ? [{ uniqueIdentifierHash }] : []),
        ...(legacyUniqueIdentifierHash && legacyUniqueIdentifierHash !== uniqueIdentifierHash
          ? [{ uniqueIdentifierHash: legacyUniqueIdentifierHash }]
          : []),
        { uniqueIdentifier },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
}
