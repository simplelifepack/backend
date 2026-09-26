import type { DocumentExtractor, ExtractedDocument } from "../types";
import { logPipelineStage } from "../logger";
import { ocrImage } from "../ocr/ocrService";

const MIN_EMBEDDED_TEXT_LENGTH = 80;
const MAX_CLASSIFICATION_PAGES = Number(process.env.MAX_CLASSIFICATION_PDF_PAGES) || 3;
const MAX_CLASSIFICATION_TEXT_CHARS = Number(process.env.MAX_CLASSIFICATION_TEXT_CHARS) || 12_000;

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
    const warnings = [...signature.warnings];
    let parser: InstanceType<(typeof import("pdf-parse"))["PDFParse"]> | null = null;

    try {
      await ensurePdfRuntime();
      const { PDFParse } = await import("pdf-parse");
      parser = new PDFParse({ url: file.path });
      const textResult = await parser.getText({ first: MAX_CLASSIFICATION_PAGES });
      const embeddedPages = textResult.pages.map((page) => ({
        pageNumber: page.num,
        text: page.text.slice(0, MAX_CLASSIFICATION_TEXT_CHARS),
      }));
      const embeddedText = (textResult.text || embeddedPages.map((page) => page.text).join("\n\n")).slice(0, MAX_CLASSIFICATION_TEXT_CHARS);
      if (textResult.total > MAX_CLASSIFICATION_PAGES) {
        warnings.push({
          code: "PDF_CLASSIFICATION_BOUNDED",
          message: `Only the first ${MAX_CLASSIFICATION_PAGES} PDF pages were inspected for classification.`,
        });
      }

      if (embeddedText.trim().length >= MIN_EMBEDDED_TEXT_LENGTH) {
        logPipelineStage("pdf_embedded_text_extracted", {
          pages: Math.min(textResult.total, MAX_CLASSIFICATION_PAGES),
          textLength: embeddedText.length,
        });

        return {
          kind: "pdf",
          mimeType: signature.detectedMimeType,
          text: embeddedText,
          combinedText: embeddedText,
          pages: embeddedPages,
          warnings,
          partial: textResult.total > MAX_CLASSIFICATION_PAGES,
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
        first: MAX_CLASSIFICATION_PAGES,
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

      const text = pages.map((page) => page.text).join("\n\n").slice(0, MAX_CLASSIFICATION_TEXT_CHARS);

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
