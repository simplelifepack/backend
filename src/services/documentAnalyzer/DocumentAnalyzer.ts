import type { DocumentAIResult, UploadedFile } from "./types";

export type AnalyzeDocumentContext = { userId?: string };

export interface DocumentAnalyzer {
  analyzeDocument(files: UploadedFile[], context?: AnalyzeDocumentContext): Promise<DocumentAIResult>;
}
