import path from "node:path";
import fs from "node:fs/promises";

import { ingestDocument } from "./ingestion/pipeline";
import type { UnifiedDocumentAnalysis, UploadedDocumentFile } from "./ingestion/types";
import { analyzeWithRules } from "./rules/engine";
import type { DocumentAnalysis } from "./rules/types";

export type DocumentType = string;

const textMimePrefixes = ["text/"];
const textMimeIncludes = ["json", "xml", "csv"];
const textExtensions = new Set([".txt", ".csv", ".json", ".xml", ".md", ".log"]);

export async function extractBasicText(filePath: string, mimeType: string): Promise<string | null> {
  const extension = path.extname(filePath).toLowerCase();
  const canReadAsText =
    textMimePrefixes.some((prefix) => mimeType.startsWith(prefix)) ||
    textMimeIncludes.some((fragment) => mimeType.includes(fragment)) ||
    textExtensions.has(extension);

  if (!canReadAsText) {
    return null;
  }

  try {
    const content = await fs.readFile(filePath, "utf8");
    return content.slice(0, 12000);
  } catch {
    return null;
  }
}

export function analyzeDocument(input: { filename: string; extractedText?: string | null }): DocumentAnalysis {
  return analyzeWithRules({
    fileName: input.filename,
    text: input.extractedText,
  });
}

export function analyzeUploadedDocument(file: UploadedDocumentFile): Promise<UnifiedDocumentAnalysis> {
  return ingestDocument(file);
}

export type { DocumentAnalysis };
export type { UnifiedDocumentAnalysis };
