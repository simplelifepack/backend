import fs from "node:fs/promises";

import type { DocumentExtractor, ExtractedDocument } from "../types";

export const textExtractor: DocumentExtractor = {
  supports: (_file, signature) => signature.kind === "text",
  async extract(file, signature): Promise<ExtractedDocument> {
    const text = await fs.readFile(file.path, "utf8");

    return {
      kind: "text",
      mimeType: signature.detectedMimeType,
      text,
      combinedText: text,
      pages: [{ pageNumber: 1, text }],
      warnings: [...signature.warnings],
      partial: false,
    };
  },
};
