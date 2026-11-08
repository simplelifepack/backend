import { z } from "zod";
import { fallbackDocumentAIResult, type DocumentAIResult } from "../services/documentAnalyzer";
import { normalizeDocumentType } from "../services/readiness/normalization";
import { normalizeCategory, saveSchema } from "./documents.helpers";
import { buildDocumentFingerprint, getDocumentDefinition, type DocumentValidationResult } from "../services/documents/fieldValidation";

const allowed = new Set(["Identity", "Employment", "Finance", "Insurance", "Property", "Medical", "Education", "Travel", "Vehicle", "Legal", "Photo", "Other"]);
export function safeAnalysis(value: DocumentAIResult): DocumentAIResult { return { ...value, category: allowed.has(value.category) ? value.category : "Other", documentType: value.documentType.trim() || "Unknown" }; }
export function buildAnalyzeResponse(input: { analysis: DocumentAIResult; files: Array<{ originalName: string; mimeType: string; size: number; tempFileId: string }>; ownership: "mine" | "other" | "unknown"; warning?: string; warningCode?: string }) {
  const analysis = safeAnalysis(input.analysis);
  return { success: true, document: { title: analysis.documentType === "Unknown" ? input.files[0]?.originalName ?? "Unknown" : analysis.documentType, ...analysis, ownership: input.ownership }, files: input.files, warnings: input.warning ? [{ code: input.warningCode ?? "AI_ANALYSIS_UNAVAILABLE", message: input.warning }] : [] };
}
export function buildMinimalAIValidation(payload: z.infer<typeof saveSchema>, fields: Record<string, unknown>): DocumentValidationResult {
  const uniqueNumber = typeof fields.uniqueNumber === "string" ? fields.uniqueNumber.trim() : ""; const normalizedType = normalizeDocumentType(payload.documentType);
  return { normalizedType, displayName: payload.documentType, category: normalizeCategory(payload.category), uniqueIdentifierField: "uniqueNumber", uniqueIdentifier: uniqueNumber || null, documentFingerprint: buildDocumentFingerprint({ normalizedType, fields, rawText: "" }), capabilities: normalizedType === "unknown" ? [] : [normalizedType], validatedFields: {}, reviewFields: [], missingRequiredFields: [], invalidFields: [], lowConfidenceFields: [], canSave: true, requiresUserConfirmation: false, warnings: [] };
}
export function prepareManualFields(documentType: string, fields: Record<string, unknown>, expiry?: string | null) {
  const prepared = { ...fields };
  const definition = getDocumentDefinition(documentType);
  const genericNumber = typeof prepared.uniqueNumber === "string" ? prepared.uniqueNumber.trim() : "";
  if (genericNumber && definition.uniqueIdentifierField !== "documentFingerprint" && !prepared[definition.uniqueIdentifierField]) {
    prepared[definition.uniqueIdentifierField] = genericNumber;
  }
  if (expiry) prepared.expiryDate = expiry;
  return prepared;
}
export function buildManualValidation(payload: z.infer<typeof saveSchema>, fields: Record<string, unknown>, originalName: string): DocumentValidationResult {
  const definition = getDocumentDefinition(payload.documentType);
  const identifierField = definition.uniqueIdentifierField === "documentFingerprint" ? "uniqueNumber" : definition.uniqueIdentifierField;
  const number = typeof fields[identifierField] === "string" ? fields[identifierField].trim() : "";
  return {
    normalizedType: definition.normalizedType,
    displayName: definition.normalizedType === "unknown" ? originalName : definition.displayName,
    category: normalizeCategory(payload.category),
    uniqueIdentifierField: identifierField,
    uniqueIdentifier: number || null,
    documentFingerprint: buildDocumentFingerprint({ normalizedType: definition.normalizedType, fields }),
    capabilities: definition.supportedReadinessCapabilities,
    validatedFields: {},
    reviewFields: [],
    missingRequiredFields: [],
    invalidFields: [],
    lowConfidenceFields: [],
    canSave: true,
    requiresUserConfirmation: false,
    warnings: [],
  };
}
export function warningCodeForAnalysisError(error: unknown) {
  const failure = error as { code?: unknown; status?: unknown } | null;
  const message = error instanceof Error ? error.message : "";
  const name = error instanceof Error ? error.name : "";
  if (failure?.code === "AI_PROCESSING_DISABLED") return "AI_PROCESSING_DISABLED";
  if (/OPENAI_API_KEY/.test(message)) return "OPENAI_API_KEY_MISSING";
  if (failure?.status === 401 || /Incorrect API key/.test(message)) return "OPENAI_API_AUTH_FAILED";
  if (failure?.code === "insufficient_quota" || /quota/i.test(message)) return "OPENAI_QUOTA_EXCEEDED";
  if (failure?.status === 429) return "AI_ANALYSIS_RATE_LIMITED";
  if (failure?.status === 408 || name === "TimeoutError" || name === "APIConnectionTimeoutError") return "AI_ANALYSIS_TIMED_OUT";
  if (name === "APIConnectionError") return "AI_ANALYSIS_CONNECTION_FAILED";
  if (message === "AI_DOCUMENT_RESPONSE_INVALID" || name === "ZodError") return "AI_ANALYSIS_INVALID_RESPONSE";
  return "AI_ANALYSIS_UNAVAILABLE";
}

export function analysisWarningMessage(code: string) {
  switch (code) {
    case "AI_ANALYSIS_TIMED_OUT": return "The AI scan timed out.";
    case "AI_ANALYSIS_RATE_LIMITED": return "The AI service is busy. Try again shortly.";
    case "AI_ANALYSIS_CONNECTION_FAILED": return "Readiness could not connect to the AI service.";
    case "AI_ANALYSIS_INVALID_RESPONSE": return "The AI service returned results that could not be used.";
    case "OPENAI_API_KEY_MISSING":
    case "OPENAI_API_AUTH_FAILED": return "The AI service credentials are missing or invalid.";
    case "OPENAI_QUOTA_EXCEEDED": return "The AI service has reached its usage quota.";
    default: return "Document analysis unavailable. Please review manually.";
  }
}

export { fallbackDocumentAIResult };
