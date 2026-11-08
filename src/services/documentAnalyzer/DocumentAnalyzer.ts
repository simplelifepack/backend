import type { DocumentAIResult, UploadedFile } from "./types";

export interface DocumentAnalyzer {
  analyzeDocuments?(files: UploadedFile[], signal?: AbortSignal): Promise<DocumentAIResult[]>;
  analyzeDocument(files: UploadedFile[], signal?: AbortSignal): Promise<DocumentAIResult>;
}
