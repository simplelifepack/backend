import { z } from "zod";

import { fallbackDocumentAIResult, type DocumentAIResult } from "../services/documentAnalyzer";
import { inferDocumentAIResult } from "../services/documentAnalyzer/openaiDocumentAnalyzer";
import {
  buildDocumentFingerprint,
  type DocumentValidationResult,
} from "../services/ingestion/documentDefinitions";
import { normalizeDocumentType } from "../services/readiness/normalization";
import { normalizeCategory, saveSchema } from "./documents.helpers";
import type { UnifiedDocumentAnalysis } from "../services/ingestion/types";

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

const titleCaseCategoryMap: Record<string, DocumentAIResult["category"]> = {
  identity: "Identity",
  employment: "Employment",
  finance: "Finance",
  insurance: "Insurance",
  property: "Property",
  medical: "Medical",
  education: "Education",
  travel: "Travel",
  vehicle: "Vehicle",
  legal: "Legal",
  photo: "Photo",
  other: "Other",
};

function toAIResultCategory(value: string): DocumentAIResult["category"] {
  const trimmed = value.trim();
  if (trimmed in categoryMap) return trimmed as DocumentAIResult["category"];
  return titleCaseCategoryMap[normalizeCategory(trimmed)] ?? "Other";
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function buildMinimalAIValidation(
  payload: z.infer<typeof saveSchema>,
  fields: Record<string, unknown>,
): DocumentValidationResult {
  const uniqueNumber = stringValue(fields.uniqueNumber);
  const nameOnDocument = stringValue(fields.nameOnDocument);
  const inferred = inferDocumentAIResult({
    category: toAIResultCategory(payload.category),
    documentType: payload.documentType,
    uniqueNumber: uniqueNumber || null,
    nameOnDocument: nameOnDocument || null,
  });
  const normalizedType = normalizeDocumentType(inferred.documentType);
  const documentFingerprint = buildDocumentFingerprint({
    normalizedType,
    fields: {
      uniqueNumber: inferred.uniqueNumber ?? uniqueNumber,
      documentType: inferred.documentType,
    },
    rawText: "",
  });

  return {
    normalizedType,
    displayName: inferred.documentType.trim() || "Unknown",
    category: normalizeCategory(inferred.category),
    uniqueIdentifierField: "uniqueNumber",
    uniqueIdentifier: inferred.uniqueNumber ? inferred.uniqueNumber : uniqueNumber || null,
    documentFingerprint,
    capabilities: normalizedType === "unknown" ? [] : [normalizedType],
    validatedFields: uniqueNumber
      ? {
          uniqueNumber: {
            key: "uniqueNumber",
            label: "Unique number",
            value: uniqueNumber,
            confidence: 100,
            required: false,
            valid: true,
            status: "accepted",
          },
        }
      : {},
    reviewFields: [],
    missingRequiredFields: [],
    invalidFields: [],
    lowConfidenceFields: [],
    canSave: true,
    requiresUserConfirmation: false,
    warnings: uniqueNumber
      ? []
      : [
          {
            code: "MISSING_UNIQUE_IDENTIFIER",
            message:
              "Unique number was not provided. You can still save and review manually later.",
          },
        ],
  };
}

export function buildAnalyzeResponse(input: {
  analysis: DocumentAIResult;
  file: Pick<Express.Multer.File, "originalname" | "mimetype" | "size">;
  tempFileId: string;
  warning?: string;
  warningCode?: string;
}) {
  const title =
    input.analysis.nameOnDocument ??
    (input.analysis.documentType === "Unknown"
      ? input.file.originalname
      : input.analysis.documentType);
  const reviewFields = input.analysis.uniqueNumber
    ? []
    : [
        {
          id: "ai-uniqueNumber",
          key: "uniqueNumber",
          label: "Unique number",
          value: "",
          confidence: 0,
          source: "user" as const,
          editable: true,
          important: false,
        },
      ];

  return {
    success: true,
    analysis: input.analysis,
    warning: input.warning,
    title,
    documentType: input.analysis.documentType,
    normalizedType: normalizeDocumentType(input.analysis.documentType),
    confidence: input.analysis.documentType === "Unknown" ? 0 : 90,
    suggestedCategory: input.analysis.category,
    extractedFields: {
      uniqueNumber: input.analysis.uniqueNumber ?? undefined,
      nameOnDocument: input.analysis.nameOnDocument ?? undefined,
    },
    reviewFields,
    validation: {
      normalizedType: normalizeDocumentType(input.analysis.documentType),
      displayName: input.analysis.documentType,
      category: normalizeCategory(input.analysis.category),
      uniqueIdentifierField: "uniqueNumber",
      uniqueIdentifier: input.analysis.uniqueNumber,
      documentFingerprint: "",
      capabilities: [],
      validatedFields: {},
      reviewFields,
      missingRequiredFields: [],
      invalidFields: [],
      lowConfidenceFields: [],
      canSave: true,
      requiresUserConfirmation: false,
      warnings: input.warning
        ? [{ code: "AI_ANALYSIS_WARNING", message: input.warning }]
        : [],
    },
    extractedText: "",
    preview: null,
    warnings: input.warning
      ? [{ code: input.warningCode ?? "AI_ANALYSIS_UNAVAILABLE", message: input.warning }]
      : [],
    reason: input.warning ?? "AI document analysis completed.",
    extraction: undefined,
    tempFileId: input.tempFileId,
    file: {
      originalName: input.file.originalname,
      mimeType: input.file.mimetype,
      size: input.file.size,
    },
    extractedTextPreview: null,
    analysisSource: "ai" as const,
  };
}

export function buildIngestionAnalyzeResponse(input: {
  analysis: UnifiedDocumentAnalysis;
  file: { originalName: string; mimeType: string; size: number };
  tempFileId: string;
}) {
  const fields = input.analysis.extractedFields as Record<string, unknown>;
  const category = toAIResultCategory(input.analysis.suggestedCategory);
  return {
    ...input.analysis,
    extractedText: "",
    preview: null,
    extraction: {
      ...input.analysis.extraction,
      pages: input.analysis.extraction.pages.map((page) => ({
        pageNumber: page.pageNumber,
        confidence: page.confidence,
      })),
    },
    analysisSource: "rules" as const,
    analysis: {
      category,
      documentType: input.analysis.documentType,
      uniqueNumber:
        typeof fields.uniqueIdentifier === "string"
          ? fields.uniqueIdentifier
          : input.analysis.validation.uniqueIdentifier,
      nameOnDocument: typeof fields.name === "string" ? fields.name : null,
    },
    tempFileId: input.tempFileId,
    file: input.file,
    extractedTextPreview: null,
  };
}

export function warningCodeForAnalysisError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("OPENAI_API_KEY")) return "OPENAI_API_KEY_MISSING";
    if (error.message.includes("Incorrect API key") || error.message.includes("401")) {
      return "OPENAI_API_AUTH_FAILED";
    }
    if (error.message.includes("quota") || error.message.includes("429")) {
      return "OPENAI_QUOTA_EXCEEDED";
    }
    if (error.message.includes("PDF AI analysis")) return "PDF_MANUAL_REVIEW_REQUIRED";
    if (error.message.includes("image uploads only")) return "UNSUPPORTED_AI_FILE_TYPE";
  }

  return "AI_ANALYSIS_UNAVAILABLE";
}

export { fallbackDocumentAIResult };
