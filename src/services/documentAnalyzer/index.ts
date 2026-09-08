import { OpenAIDocumentAnalyzer } from "./openaiDocumentAnalyzer";
import { fallbackDocumentAIResult } from "./types";
import type { DocumentAnalyzer } from "./DocumentAnalyzer";
import type { DocumentAIResult, UploadedFile } from "./types";

let analyzer: DocumentAnalyzer | null = null;

export function getDocumentAnalyzer(): DocumentAnalyzer {
  if (!analyzer) {
    analyzer = new OpenAIDocumentAnalyzer();
  }

  return analyzer;
}

export async function analyzeDocument(files: UploadedFile[]): Promise<DocumentAIResult> {
  return getDocumentAnalyzer().analyzeDocument(files);
}

export { fallbackDocumentAIResult };
export type { DocumentAnalyzer, DocumentAIResult, UploadedFile };
