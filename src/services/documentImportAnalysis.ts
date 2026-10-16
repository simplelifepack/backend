import { analyzeDocument, fallbackDocumentAIResult, type UploadedFile } from "./documentAnalyzer";
import { assertAIProcessingEnabled } from "./aiProcessing.service";
import { getDocumentDefinition, validateDocumentMetadata } from "./documents/fieldValidation";

// Imports use the same original-file AI path as uploads. Disabled/unavailable
// AI leaves the encrypted original available for manual review, never OCR.
export async function analyzeImportedDocument(userId: string, file: UploadedFile, dependencies = { assertAIProcessingEnabled, analyzeDocument }) {
  let result = fallbackDocumentAIResult;
  let analysisSource: "ai" | "manual" = "manual";
  const warnings: Array<{ code: string; message: string }> = [];
  try {
    await dependencies.assertAIProcessingEnabled(userId);
    result = await dependencies.analyzeDocument([file]);
    if (result.documentType.toLowerCase() === "unknown") warnings.push({ code: "AI_ANALYSIS_UNAVAILABLE", message: "The document could not be read confidently. Retry or enter details manually." });
    else analysisSource = "ai";
  } catch (error) {
    const disabled = (error as { code?: unknown })?.code === "AI_PROCESSING_DISABLED";
    warnings.push({ code: disabled ? "AI_PROCESSING_DISABLED" : "AI_ANALYSIS_UNAVAILABLE", message: disabled ? "AI is disabled. Enter document details manually." : "AI analysis is unavailable. Retry or enter document details manually." });
  }
  const fields: Record<string, unknown> = { ...(result.fields ?? {}), ...(result.uniqueNumber ? { uniqueIdentifier: result.uniqueNumber, uniqueNumber: result.uniqueNumber } : {}), ...(result.nameOnDocument ? { name: result.nameOnDocument, nameOnDocument: result.nameOnDocument } : {}), ...(result.expiryDate ? { expiryDate: result.expiryDate } : {}) };
  const identifierField = getDocumentDefinition(result.documentType).uniqueIdentifierField;
  if (result.uniqueNumber && identifierField) fields[identifierField] = result.uniqueNumber;
  const confidence = analysisSource === "ai" ? 95 : 0;
  const validation = validateDocumentMetadata({ documentType: result.documentType, fields, confidence });
  const extractedText = result.extractedText ?? "";
  return {
    success: true, analysisSource, documentType: validation.normalizedType, confidence,
    suggestedCategory: result.category.toLowerCase(), extractedFields: fields,
    reviewFields: validation.reviewFields, validation,
    title: result.documentType === "Unknown" ? file.originalName : result.documentType,
    extractedText, preview: extractedText ? extractedText.slice(0, 500) : null,
    warnings, reason: warnings[0]?.message,
    extraction: { kind: file.mimeType === "application/pdf" ? "pdf" : file.mimeType.startsWith("image/") ? "image" : "file", mimeType: file.mimeType, pages: [], partial: analysisSource !== "ai" },
    analysis: { analysisSource, evidence: [] as Array<{ label: string; points: number }> },
  };
}
