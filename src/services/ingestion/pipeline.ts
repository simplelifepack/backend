import { classifyDocument, drivingLicenceSatisfies } from "./classifier/classifyDocument";
import { validateDocumentMetadata } from "./documentDefinitions";
import { extractors } from "./extractors";
import { extractStructuredFields } from "./fieldExtractors";
import { logPipelineStage } from "./logger";
import { normalizeDocumentText } from "./normalizer/normalizeDocumentText";
import { extractReviewFields, generateDocumentTitle } from "./reviewFieldExtractor";
import type { UnifiedDocumentAnalysis, UploadedDocumentFile } from "./types";
import { detectFileSignature } from "./validators/fileSignature";

export async function ingestDocument(file: UploadedDocumentFile): Promise<UnifiedDocumentAnalysis> {
  logPipelineStage("upload_received", {
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
  });

  const signature = await detectFileSignature(file);
  logPipelineStage("mime_type_determined", {
    originalName: file.originalName,
    declaredMimeType: signature.mimeType,
    detectedMimeType: signature.detectedMimeType,
    kind: signature.kind,
    isSupported: signature.isSupported,
  });

  if (!signature.isSupported) {
    const analysis = classifyDocument({ fileName: file.originalName, text: "" });

    return {
      success: false,
      documentType: analysis.documentType,
      confidence: analysis.confidence,
      suggestedCategory: analysis.category,
      extractedFields: {},
      reviewFields: [],
      validation: validateDocumentMetadata({
        documentType: analysis.documentType,
        rawText: "",
        fields: {},
        confidence: analysis.confidence,
      }),
      title: file.originalName,
      extractedText: "",
      preview: null,
      warnings: signature.warnings,
      reason: signature.warnings[0]?.message ?? "Unsupported file type.",
      extraction: {
        kind: signature.kind,
        mimeType: signature.detectedMimeType,
        pages: [],
        partial: true,
      },
      analysis,
    };
  }

  const extractor = extractors.find((candidate) => candidate.supports(file, signature));

  if (!extractor) {
    throw new Error("No extractor is registered for this file type.");
  }

  const extracted = await extractor.extract(file, signature);
  logPipelineStage("text_extracted", {
    kind: extracted.kind,
    textLength: extracted.text.length,
    pages: extracted.pages.length,
    partial: extracted.partial,
  });
  const normalizedText = normalizeDocumentText(extracted.text);
  const normalizedPages = extracted.pages.map((page) => ({
    ...page,
    text: normalizeDocumentText(page.text),
  }));
  const analysis = classifyDocument({
    fileName: file.originalName,
    text: normalizedText,
    hints: extracted.hints,
  });
  logPipelineStage("classification_completed", {
    documentType: analysis.documentType,
    confidence: analysis.confidence,
    category: analysis.category,
  });
  const extractedFields = extractStructuredFields(analysis);
  const extractedReviewFields = extractReviewFields({
    analysis,
    text: normalizedText,
    pages: normalizedPages,
  });
  const validation = validateDocumentMetadata({
    documentType: analysis.documentType,
    rawText: normalizedText,
    fields: extractedFields,
    reviewFields: extractedReviewFields,
    confidence: analysis.confidence,
  });
  const reviewFields = validation.reviewFields.length ? validation.reviewFields : extractedReviewFields.filter((field) => field.important && (field.confidence ?? 0) < 90);
  const title = generateDocumentTitle({
    reviewFields: extractedReviewFields,
    documentType: analysis.documentType,
    originalName: file.originalName,
  });
  logPipelineStage("field_extraction_completed", {
    fieldCount: Object.keys(extractedFields).length,
    reviewFieldCount: reviewFields.length,
  });
  const success = Boolean(normalizedText) && analysis.confidence > 0;
  const warnings = [...extracted.warnings];
  if (
    (analysis.documentType === "Driving Licence" || analysis.documentType === "Indian Driving Licence") &&
    (analysis.analysisSource === "manual" || !analysis.fields.licenseNumber)
  ) {
    if (!warnings.some((warning) => warning.code === "LOW_OCR_CONFIDENCE")) {
      warnings.push({
        code: "LOW_OCR_CONFIDENCE",
        message: "Some text could not be read clearly. Please review extracted fields.",
      });
    }
    if (!warnings.some((warning) => warning.code === "PLEASE_REVIEW_FIELDS")) {
      warnings.push({
        code: "PLEASE_REVIEW_FIELDS",
        message: "Document fields were inferred from partial OCR and visual layout clues.",
      });
    }
  }
  const satisfies = analysis.documentType === "Driving Licence" || analysis.documentType === "Indian Driving Licence" ? drivingLicenceSatisfies : undefined;
  for (const warning of validation.warnings) {
    if (!warnings.some((item) => item.code === warning.code)) warnings.push(warning);
  }
  const capabilities = validation.capabilities.length ? validation.capabilities : satisfies;

  const response: UnifiedDocumentAnalysis = {
    success,
    documentType: analysis.documentType,
    confidence: analysis.confidence,
    suggestedCategory: analysis.category,
    extractedFields,
    reviewFields,
    validation,
    title,
    extractedText: normalizedText,
    preview: normalizedText ? normalizedText.slice(0, 500) : null,
    warnings,
    reason: success ? analysis.reason : warnings[0]?.message ?? analysis.reason,
    extraction: {
      kind: extracted.kind,
      mimeType: extracted.mimeType,
      pages: normalizedPages,
      partial: extracted.partial,
      hints: extracted.hints,
    },
    analysis: {
      ...analysis,
      fields: {
        ...extractedFields,
        uniqueIdentifier: validation.uniqueIdentifier ?? undefined,
        uniqueIdentifierField: validation.uniqueIdentifierField,
        documentFingerprint: validation.documentFingerprint,
        capabilities,
        validatedFields: validation.validatedFields,
      },
    },
    satisfies: capabilities,
  };

  logPipelineStage("response_generated", {
    success: response.success,
    warningCount: response.warnings.length,
  });

  return response;
}
