import type { DocumentAnalysis } from "../rules/types";
import type { DocumentValidationResult } from "./documentDefinitions";

export type SupportedDocumentKind = "image" | "pdf" | "office" | "text";

export type UploadedDocumentFile = {
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export type PageText = {
  pageNumber: number;
  text: string;
  confidence?: number;
};

export type ExtractionWarning = {
  code: string;
  message: string;
};

export type ExtractionHints = {
  ocr?: {
    bestVariant?: string;
    bestRotation?: number;
    variantCount?: number;
    keywordScore?: number;
    regexScore?: number;
    layoutSignals?: string[];
    allText?: string;
  };
};

export type ReviewFieldSource = "template" | "rule" | "generic" | "ocr" | "user";

export type ReviewField = {
  id: string;
  key: string;
  label: string;
  value: string;
  confidence?: number;
  source: ReviewFieldSource;
  editable: boolean;
  important?: boolean;
  pageNumber?: number;
};

export type ExtractedDocument = {
  kind: SupportedDocumentKind;
  mimeType: string;
  text: string;
  combinedText: string;
  pages: PageText[];
  warnings: ExtractionWarning[];
  hints?: ExtractionHints;
  partial: boolean;
};

export type DocumentExtractor = {
  supports: (file: UploadedDocumentFile, signature: FileSignature) => boolean;
  extract: (file: UploadedDocumentFile, signature: FileSignature) => Promise<ExtractedDocument>;
};

export type FileSignature = {
  extension: string;
  mimeType: string;
  detectedMimeType: string;
  kind: SupportedDocumentKind;
  isSupported: boolean;
  warnings: ExtractionWarning[];
};

export type UnifiedDocumentAnalysis = {
  success: boolean;
  documentType: string;
  confidence: number;
  suggestedCategory: string;
  extractedFields: DocumentAnalysis["fields"];
  reviewFields: ReviewField[];
  validation: DocumentValidationResult;
  title: string;
  extractedText: string;
  preview: string | null;
  warnings: ExtractionWarning[];
  reason?: string;
  extraction: {
    kind: SupportedDocumentKind;
    mimeType: string;
    pages: PageText[];
    partial: boolean;
    hints?: ExtractionHints;
  };
  analysis: DocumentAnalysis;
  satisfies?: string[];
};
