import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import {
  assertDocumentSecurityScannerConfigured,
  validateDecryptedDocument,
  withIsolatedPlaintextFile,
} from "./documentSecurityValidation";

function minimalPdf(extra = "") {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    `<< /Length ${extra.length} >>\nstream\n${extra}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

async function run() {
  assert.throws(
    () => assertDocumentSecurityScannerConfigured({ NODE_ENV: "production" }),
    /required in production/,
  );
  assert.doesNotThrow(() =>
    assertDocumentSecurityScannerConfigured({
      NODE_ENV: "production",
      DOCUMENT_MALWARE_SCANNER_COMMAND: "clamscan",
      DOCUMENT_MALWARE_SCANNER_ARGS: '["--no-summary","{file}"]',
    }),
  );
  const pdf = minimalPdf("BT /F1 12 Tf ET");
  await validateDecryptedDocument(pdf, {
    originalFilename: "valid.pdf",
    originalMimeType: "application/pdf",
    originalSize: pdf.length,
  });
  const unsafePdf = minimalPdf("/JavaScript /JS (app.alert)");
  await assert.rejects(
    () => validateDecryptedDocument(unsafePdf, {
      originalFilename: "unsafe.pdf",
      originalMimeType: "application/pdf",
      originalSize: unsafePdf.length,
    }),
    /active or embedded content/,
  );
  for (const marker of ["/Encrypt", "/EmbeddedFile /Filespec"]) {
    const rejectedPdf = minimalPdf(marker);
    await assert.rejects(
      () => validateDecryptedDocument(rejectedPdf, {
        originalFilename: "rejected.pdf",
        originalMimeType: "application/pdf",
        originalSize: rejectedPdf.length,
      }),
      marker === "/Encrypt" ? /Password-protected/ : /active or embedded content/,
    );
  }
  const truncatedPdf = Buffer.from("%PDF-1.4\n1 0 obj\n");
  await assert.rejects(
    () => validateDecryptedDocument(truncatedPdf, {
      originalFilename: "truncated.pdf",
      originalMimeType: "application/pdf",
      originalSize: truncatedPdf.length,
    }),
    /truncated/,
  );
  const malwarePdf = Buffer.concat([
    minimalPdf(),
    Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"),
  ]);
  await assert.rejects(
    () => validateDecryptedDocument(malwarePdf, {
      originalFilename: "malware.pdf",
      originalMimeType: "application/pdf",
      originalSize: malwarePdf.length,
    }),
    /security scanning/,
  );

  for (const format of ["jpeg", "png", "webp"] as const) {
    const bytes = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#ffffff" },
    })[format]().toBuffer();
    await validateDecryptedDocument(bytes, {
      originalFilename: `valid.${format === "jpeg" ? "jpg" : format}`,
      originalMimeType: `image/${format}` as "image/jpeg" | "image/png" | "image/webp",
      originalSize: bytes.length,
    });
    if (format === "png") {
      await assert.rejects(
        () => validateDecryptedDocument(bytes.subarray(0, -1), {
          originalFilename: "truncated.png",
          originalMimeType: "image/png",
          originalSize: bytes.length - 1,
        }),
        /truncated/,
      );
    }
  }

  const wide = await sharp({
    create: { width: 12_001, height: 1, channels: 3, background: "#ffffff" },
  }).png().toBuffer();
  await assert.rejects(
    () => validateDecryptedDocument(wide, {
      originalFilename: "wide.png",
      originalMimeType: "image/png",
      originalSize: wide.length,
    }),
    /dimensions exceed/,
  );

  let isolatedPath = "";
  await assert.rejects(
    () => withIsolatedPlaintextFile(pdf, ".pdf", async (filePath) => {
      isolatedPath = filePath;
      throw new Error("forced failure");
    }),
    /forced failure/,
  );
  await assert.rejects(() => fs.stat(isolatedPath));
  await assert.rejects(() => fs.stat(path.dirname(isolatedPath)));
  console.log("document security validation tests passed");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
