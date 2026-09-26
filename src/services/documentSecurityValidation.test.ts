import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import {
  assertDocumentSecurityScannerConfigured,
  validateDecryptedDocument,
  withIsolatedPlaintextFile,
} from "./documentSecurityValidation";

function minimalPdf(input: string | {
  catalogExtra?: string;
  content?: string;
  extraObjects?: string[];
} = "") {
  const options = typeof input === "string" ? { content: input } : input;
  const catalogExtra = options.catalogExtra ? ` ${options.catalogExtra}` : "";
  const content = options.content ?? "";
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${catalogExtra} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...(options.extraObjects ?? []),
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

function pdfWithEmbeddedFile(subtype: string, filename = "attachment.bin") {
  return minimalPdf({
    catalogExtra: "/Names << /EmbeddedFiles << /Names [(Content Credentials) 5 0 R] >> >>",
    extraObjects: [
      `<< /Type /Filespec /F (${filename}) /EF << /F 6 0 R >> >>`,
      `<< /Type /EmbeddedFile /Subtype /${subtype} /Length 4 >>\nstream\ndata\nendstream`,
    ],
  });
}

async function assertPdfAllowed(pdf: Buffer, filename: string) {
  await validateDecryptedDocument(pdf, {
    originalFilename: filename,
    originalMimeType: "application/pdf",
    originalSize: pdf.length,
  });
}

async function assertPdfRejectedAsUnsafe(pdf: Buffer, filename: string) {
  await assert.rejects(
    () => validateDecryptedDocument(pdf, {
      originalFilename: filename,
      originalMimeType: "application/pdf",
      originalSize: pdf.length,
    }),
    /plain PDF or image copy/,
  );
}

async function run() {
  assert.doesNotThrow(() => assertDocumentSecurityScannerConfigured({ NODE_ENV: "production" }));
  assert.throws(
    () => assertDocumentSecurityScannerConfigured({ DOCUMENT_MALWARE_SCANNER_ARGS: '{bad json' }),
    /JSON/,
  );
  assert.doesNotThrow(() =>
    assertDocumentSecurityScannerConfigured({
      NODE_ENV: "production",
      DOCUMENT_MALWARE_SCANNER_COMMAND: "clamscan",
      DOCUMENT_MALWARE_SCANNER_ARGS: '["--no-summary","{file}"]',
    }),
  );
  const pdf = minimalPdf("BT /F1 12 Tf ET");
  await assertPdfAllowed(pdf, "valid.pdf");
  const c2paPdf = pdfWithEmbeddedFile("application#2Fc2pa", "content-credentials.c2pa");
  await assertPdfAllowed(c2paPdf, "c2pa.pdf");
  const downloadedBankStatement = path.resolve(
    os.homedir(),
    "Downloads/test_bank_statement_august_2026.pdf",
  );
  try {
    const bankStatementPdf = await fs.readFile(downloadedBankStatement);
    await assertPdfAllowed(bankStatementPdf, "test_bank_statement_august_2026.pdf");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const unsafePdf = minimalPdf("/JavaScript /JS (app.alert)");
  await assertPdfRejectedAsUnsafe(unsafePdf, "unsafe.pdf");
  await assertPdfRejectedAsUnsafe(
    minimalPdf("<< /S /Launch /F (run.exe) >>"),
    "launch-action.pdf",
  );
  const benignPdf = minimalPdf("/Filespec /JSName (not an action)");
  await assertPdfAllowed(benignPdf, "benign.pdf");
  await assertPdfRejectedAsUnsafe(
    pdfWithEmbeddedFile("text#2Fplain", "notes.txt"),
    "attached-document.pdf",
  );
  await assertPdfRejectedAsUnsafe(
    pdfWithEmbeddedFile("application#2Fx-msdownload", "run.exe"),
    "attached-executable.pdf",
  );
  for (const marker of ["/Encrypt", "/EmbeddedFile /Filespec"]) {
    const rejectedPdf = minimalPdf(marker);
    await assert.rejects(
      () => validateDecryptedDocument(rejectedPdf, {
        originalFilename: "rejected.pdf",
        originalMimeType: "application/pdf",
        originalSize: rejectedPdf.length,
      }),
      marker === "/Encrypt" ? /password-protected/ : /plain PDF or image copy/,
    );
  }
  const truncatedPdf = Buffer.from("%PDF-1.4\n1 0 obj\n");
  await assert.rejects(
    () => validateDecryptedDocument(truncatedPdf, {
      originalFilename: "truncated.pdf",
      originalMimeType: "application/pdf",
      originalSize: truncatedPdf.length,
    }),
    { code: "FILE_CORRUPTED", message: "This file appears to be corrupted. Please try uploading another copy." },
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
        { code: "FILE_CORRUPTED", message: "This file appears to be corrupted. Please try uploading another copy." },
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
    { code: "IMAGE_DIMENSIONS_EXCEEDED" },
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
