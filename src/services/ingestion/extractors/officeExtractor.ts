import fs from "node:fs/promises";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";

import type { DocumentExtractor, ExtractedDocument } from "../types";

function stripRtf(raw: string) {
  return raw
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\tab/g, "\t")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+\d* ?/g, "")
    .replace(/[{}]/g, " ")
    .replace(/[ \t]{2,}/g, " ");
}

export const officeExtractor: DocumentExtractor = {
  supports: (_file, signature) => signature.kind === "office",
  async extract(file, signature): Promise<ExtractedDocument> {
    const warnings = [...signature.warnings];

    if (signature.extension === ".rtf" || signature.detectedMimeType === "application/rtf") {
      const raw = await fs.readFile(file.path, "utf8");
      const text = stripRtf(raw);

      return {
        kind: "office",
        mimeType: signature.detectedMimeType,
        text,
        combinedText: text,
        pages: [{ pageNumber: 1, text }],
        warnings,
        partial: false,
      };
    }

    if (signature.extension === ".docx") {
      const result = await mammoth.extractRawText({ path: file.path });
      const text = result.value;

      return {
        kind: "office",
        mimeType: signature.detectedMimeType,
        text,
        combinedText: text,
        pages: [{ pageNumber: 1, text }],
        warnings: [
          ...warnings,
          ...result.messages.map((message) => ({
            code: message.type === "warning" ? "DOCX_WARNING" : "DOCX_ERROR",
            message: message.message,
          })),
        ],
        partial: result.messages.some((message) => message.type === "error"),
      };
    }

    if (signature.extension === ".doc") {
      const extractor = new WordExtractor();
      const document = await extractor.extract(file.path);
      const sections = [
        document.getHeaders(),
        document.getBody(),
        document.getFootnotes(),
        document.getEndnotes(),
        document.getFooters(),
      ].filter(Boolean);
      const text = sections.join("\n\n");

      return {
        kind: "office",
        mimeType: signature.detectedMimeType,
        text,
        combinedText: text,
        pages: [{ pageNumber: 1, text }],
        warnings,
        partial: !text.trim(),
      };
    }

    warnings.push({
      code: "OFFICE_PARSER_REQUIRED",
      message: "This Office format is not supported by the configured parsers.",
    });

    return {
      kind: "office",
      mimeType: signature.detectedMimeType,
      text: "",
      combinedText: "",
      pages: [],
      warnings,
      partial: true,
    };
  },
};
