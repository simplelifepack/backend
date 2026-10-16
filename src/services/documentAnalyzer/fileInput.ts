import type { ResponseInputContent } from "openai/resources/responses/responses";
import path from "node:path";
export type OriginalDocumentFile = { bytes: Buffer; mimeType: string; name: string };
// File preparation only: no OCR, PDF text parsing or local classification.
export function originalDocumentInput(file: OriginalDocumentFile): ResponseInputContent {
  if (!file.bytes.length) throw new Error("DOCUMENT_SOURCE_EMPTY");
  const encoded = file.bytes.toString("base64");
  return file.mimeType.startsWith("image/")
    ? { type: "input_image", image_url: `data:${file.mimeType};base64,${encoded}`, detail: "high" }
    : { type: "input_file", filename: path.basename(file.name), file_data: `data:${file.mimeType};base64,${encoded}` };
}
