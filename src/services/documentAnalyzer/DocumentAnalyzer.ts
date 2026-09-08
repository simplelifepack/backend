import type { DocumentAIResult, UploadedFile } from "./types";

export interface DocumentAnalyzer {
  analyzeDocument(files: UploadedFile[]): Promise<DocumentAIResult>;
}
