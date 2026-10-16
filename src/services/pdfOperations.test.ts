import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument, degrees } from "pdf-lib";
import { validateDecryptedDocument } from "./documentSecurityValidation";

test("validation preserves merged, reordered, rotated and removed PDF pages", async () => {
  const first = await PDFDocument.create(); first.addPage([100, 200]); first.addPage([200, 300]);
  const second = await PDFDocument.create(); second.addPage([300, 400]);
  const merged = await PDFDocument.create();
  const one = await merged.copyPages(first, [1, 0]); const two = await merged.copyPages(second, [0]);
  [...one, ...two].forEach(page => merged.addPage(page)); merged.removePage(1); merged.getPage(0).setRotation(degrees(90));
  const bytes = Buffer.from(await merged.save());
  await validateDecryptedDocument(bytes, { originalFilename: "prepared.pdf", originalMimeType: "application/pdf", originalSize: bytes.length });
  const roundtrip = await PDFDocument.load(bytes); assert.equal(roundtrip.getPageCount(), 2); assert.equal(roundtrip.getPage(0).getRotation().angle, 90);
  assert.deepEqual(roundtrip.getPages().map(page => page.getWidth()), [200, 300]);
  const page = await PDFDocument.create(); (await page.copyPages(roundtrip, [1])).forEach(item => page.addPage(item));
  assert.equal((await PDFDocument.load(await page.save())).getPageCount(), 1);
});
