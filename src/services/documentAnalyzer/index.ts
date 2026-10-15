import { OpenAIDocumentAnalyzer } from "./openaiDocumentAnalyzer";
import { fallbackDocumentAIResult } from "./types";
import type { AnalyzeDocumentContext, DocumentAnalyzer } from "./DocumentAnalyzer";
import type { DocumentAIResult, UploadedFile } from "./types";

let analyzer: DocumentAnalyzer | null = null;

export function getDocumentAnalyzer(): DocumentAnalyzer {
  if (!analyzer) {
    analyzer = new OpenAIDocumentAnalyzer();
  }

  return analyzer;
}

export async function analyzeDocument(files: UploadedFile[], context?: AnalyzeDocumentContext): Promise<DocumentAIResult> {
  return getDocumentAnalyzer().analyzeDocument(files, context);
}

export { fallbackDocumentAIResult };
export type { AnalyzeDocumentContext, DocumentAnalyzer, DocumentAIResult, UploadedFile };
