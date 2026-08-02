import type { DocumentExtractor, ExtractedDocument } from "../types";
import { ocrImage } from "../ocr/ocrService";

export const imageExtractor: DocumentExtractor = {
  supports: (_file, signature) => signature.kind === "image",
  async extract(file, signature): Promise<ExtractedDocument> {
    const ocr = await ocrImage(file.path);

    return {
      kind: "image",
      mimeType: signature.detectedMimeType,
      text: ocr.text,
      combinedText: ocr.text,
      pages: [{ pageNumber: 1, text: ocr.text, confidence: ocr.confidence }],
      warnings: [...signature.warnings, ...ocr.warnings],
      hints: ocr.hints,
      partial: !ocr.text.trim(),
    };
  },
};
