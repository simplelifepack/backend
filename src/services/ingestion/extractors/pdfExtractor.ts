import fs from "node:fs/promises";

import type { DocumentExtractor, ExtractedDocument } from "../types";
import { logPipelineStage } from "../logger";
import { ocrImage } from "../ocr/ocrService";

const MIN_EMBEDDED_TEXT_LENGTH = 80;

async function ensurePdfRuntime() {
  const runtime = globalThis as Record<string, unknown>;
  if (runtime.DOMMatrix && runtime.ImageData && runtime.Path2D) return;
  const canvas = await import("@napi-rs/canvas");
  runtime.DOMMatrix ??= canvas.DOMMatrix;
  runtime.ImageData ??= canvas.ImageData;
  runtime.Path2D ??= canvas.Path2D;
}

export const pdfExtractor: DocumentExtractor = {
  supports: (_file, signature) => signature.kind === "pdf",
  async extract(file, signature): Promise<ExtractedDocument> {
    const buffer = await fs.readFile(file.path);
    const warnings = [...signature.warnings];
    let parser: InstanceType<(typeof import("pdf-parse"))["PDFParse"]> | null = null;

    try {
      await ensurePdfRuntime();
      const { PDFParse } = await import("pdf-parse");
      parser = new PDFParse({ data: buffer });
      const textResult = await parser.getText();
      const embeddedPages = textResult.pages.map((page) => ({
        pageNumber: page.num,
        text: page.text,
      }));
      const embeddedText = textResult.text || embeddedPages.map((page) => page.text).join("\n\n");

      if (embeddedText.trim().length >= MIN_EMBEDDED_TEXT_LENGTH) {
        logPipelineStage("pdf_embedded_text_extracted", {
          pages: textResult.total,
          textLength: embeddedText.length,
        });

        return {
          kind: "pdf",
          mimeType: signature.detectedMimeType,
          text: embeddedText,
          combinedText: embeddedText,
          pages: embeddedPages,
          warnings,
          partial: false,
        };
      }

      warnings.push({
        code: "PDF_SCANNED",
        message: embeddedText.trim()
          ? "Embedded PDF text was too sparse. OCR was used page by page."
          : "No embedded PDF text was found. OCR was used page by page.",
      });

      const screenshots = await parser.getScreenshot({
        imageBuffer: true,
        scale: 2,
      });
      const pages = [];

      for (const screenshot of screenshots.pages) {
        const ocr = await ocrImage(Buffer.from(screenshot.data));
        pages.push({
          pageNumber: screenshot.pageNumber,
          text: ocr.text,
          confidence: ocr.confidence,
        });
        warnings.push(...ocr.warnings.map((warning) => ({
          ...warning,
          message: `Page ${screenshot.pageNumber}: ${warning.message}`,
        })));
      }

      const text = pages.map((page) => page.text).join("\n\n");

      return {
        kind: "pdf",
        mimeType: signature.detectedMimeType,
        text,
        combinedText: text,
        pages,
        warnings,
        partial: pages.some((page) => !page.text.trim()),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDF extraction failed.";

      return {
        kind: "pdf",
        mimeType: signature.detectedMimeType,
        text: "",
        combinedText: "",
        pages: [],
        warnings: [
          ...warnings,
          {
            code: /password/i.test(message) ? "PDF_PASSWORD_PROTECTED" : "PDF_EXTRACTION_FAILED",
            message,
          },
        ],
        partial: true,
      };
    } finally {
      await parser?.destroy().catch(() => undefined);
    }
  },
};
