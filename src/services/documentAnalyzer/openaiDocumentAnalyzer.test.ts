import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { OpenAIDocumentAnalyzer, validateDocumentAIResult } from "./openaiDocumentAnalyzer";
const answer = { category: "Finance", documentType: "Bank statement", uniqueNumber: null, nameOnDocument: null, expiryDate: null, extractedText: "Synthetic statement text", fields: [{ key: "accountHolder", value: "Synthetic person" }] };

test("AI results retain text/structured fields and normalize identifiers", () => {
  const value = validateDocumentAIResult({ category: "Other", documentType: "Unknown", uniqueNumber: "abcde1234f", nameOnDocument: "Example", expiryDate: null });
  assert.equal(value.category, "Identity"); assert.equal(value.documentType, "PAN Card"); assert.equal(value.uniqueNumber, "ABCDE1234F"); assert.equal(value.expiryDate, null);
});
test("original PDFs and every image page go directly to AI without text extraction or page sampling", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "document-ai-input-"));
  try {
    const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
    const filePath = path.join(directory, "scanned.pdf"); await fs.writeFile(filePath, bytes);
    let calls = 0;
    const analyzer = new OpenAIDocumentAnalyzer(undefined, "synthetic", async body => {
      calls++; assert.equal(body.store, false); const input = body.input as Array<{ content: Array<{ type: string; file_data?: string; image_url?: string }> }>;
      const attached = input[0].content.filter(item => item.type !== "input_text"); assert.equal(attached.length, 6);
      assert.equal(attached[0].type, "input_file"); assert.equal(attached[0].file_data, `data:application/pdf;base64,${bytes.toString("base64")}`);
      assert(attached.slice(1).every(item => item.type === "input_image"));
      return { output_text: JSON.stringify(answer) };
    });
    const imagePath = path.join(directory, "image.png"); await fs.writeFile(imagePath, Buffer.from("synthetic-image"));
    const result = await analyzer.analyzeDocument([{ path: filePath, mimeType: "application/pdf", originalName: "scanned.pdf", size: bytes.length }, ...Array.from({ length: 5 }, () => ({ path: imagePath, mimeType: "image/png", originalName: "page.png", size: 15 }))]);
    assert.equal(calls, 1); assert.equal(result.extractedText, answer.extractedText); assert.deepEqual(result.fields, { accountHolder: "Synthetic person" });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test("invalid AI output fails instead of invoking a local extractor", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "document-ai-invalid-"));
  try {
    const file = path.join(directory, "input.pdf"); await fs.writeFile(file, "opaque original");
    const analyzer = new OpenAIDocumentAnalyzer(undefined, "synthetic", async () => ({ output_text: "unreadable response" }));
    await assert.rejects(analyzer.analyzeDocument([{ path: file, mimeType: "application/pdf", originalName: "input.pdf", size: 15 }]), /AI_DOCUMENT_RESPONSE_INVALID/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
