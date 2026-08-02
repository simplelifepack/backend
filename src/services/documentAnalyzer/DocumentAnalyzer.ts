import type { DocumentAIResult, UploadedFile } from "./types";

export interface DocumentAnalyzer {
  analyzeDocument(file: UploadedFile): Promise<DocumentAIResult>;
}
