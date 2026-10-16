import assert from "node:assert/strict";
import { test } from "node:test";
import { extractHealthDocument, setHealthExtractionRequestForTests } from "./healthExtraction.service";

test("health sends every original page to AI with provider storage disabled", async () => {
  const files = [{ name: "scan.pdf", mimeType: "application/pdf", bytes: Buffer.from("synthetic-pdf") }, ...Array.from({ length: 5 }, () => ({ name: "page.png", mimeType: "image/png", bytes: Buffer.from("synthetic-image") }))];
  setHealthExtractionRequestForTests(async body => {
    assert.equal(body.store, false);
    const input = body.input as Array<{ content: Array<{ type: string; file_data?: string }> }>;
    const attachments = input[0].content.filter(item => item.type !== "input_text");
    assert.equal(attachments.length, 6); assert.equal(attachments[0].file_data, `data:application/pdf;base64,${files[0].bytes.toString("base64")}`);
    assert(attachments.slice(1).every(item => item.type === "input_image"));
    return { output_text: JSON.stringify({ documentType: "lab_report", patient: null, measurements: [{ name: "Glucose", value: 103, unit: "mg/dL" }], medications: [], followUps: [] }) };
  });
  try { assert.equal((await extractHealthDocument({ files })).measurements[0].value, 103); } finally { setHealthExtractionRequestForTests(null); }
});
test("health AI invalid output fails without a local text/OCR fallback", async () => {
  setHealthExtractionRequestForTests(async () => ({ output_text: "invalid response" }));
  try { await assert.rejects(extractHealthDocument({ files: [{ name: "scan.pdf", mimeType: "application/pdf", bytes: Buffer.from("synthetic-pdf") }] })); } finally { setHealthExtractionRequestForTests(null); }
});
