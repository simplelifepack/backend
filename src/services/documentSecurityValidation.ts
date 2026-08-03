import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertDocumentSecurityScannerConfigured, loadMalwareScanner } from "./malwareScanner";
import sharp from "sharp";

import {
  DocumentEnvelopeError,
  type ValidatedEncryptedEnvelope,
} from "./documentHybridEncryption";

const MAX_IMAGE_WIDTH = Number(process.env.MAX_DOCUMENT_IMAGE_WIDTH) || 12_000;
const MAX_IMAGE_HEIGHT = Number(process.env.MAX_DOCUMENT_IMAGE_HEIGHT) || 12_000;
const MAX_IMAGE_PIXELS = Number(process.env.MAX_DOCUMENT_IMAGE_PIXELS) || 60_000_000;
const MAX_PDF_PAGES = Number(process.env.MAX_DOCUMENT_PDF_PAGES) || 500;
const EICAR_MARKER = Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");

export { assertDocumentSecurityScannerConfigured };

function assertStaticPdfSafety(plaintext: Buffer) {
  if (!plaintext.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new DocumentEnvelopeError("FILE_SIGNATURE_MISMATCH", "The PDF signature is invalid.", 422);
  }
  if (!plaintext.subarray(Math.max(0, plaintext.length - 4096)).includes(Buffer.from("%%EOF"))) {
    throw new DocumentEnvelopeError("FILE_CORRUPTED", "The PDF is truncated.", 422);
  }
  const source = plaintext.toString("latin1");
  if (/\/Encrypt\b/.test(source)) {
    throw new DocumentEnvelopeError(
      "PASSWORD_PROTECTED_FILE",
      "Password-protected PDFs are not supported.",
      422,
    );
  }
  if (/\/(?:JavaScript|JS|Launch|EmbeddedFile|Filespec)\b|\/AA\s*<</.test(source)) {
    throw new DocumentEnvelopeError(
      "UNSAFE_FILE",
      "The PDF contains unsupported active or embedded content.",
      422,
    );
  }
}

async function validatePdf(plaintext: Buffer) {
  assertStaticPdfSafety(plaintext);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: plaintext });
  try {
    const info = await parser.getInfo({ parsePageInfo: true });
    if (info.total < 1 || info.total > MAX_PDF_PAGES) {
      throw new DocumentEnvelopeError(
        "UNSAFE_FILE",
        `PDFs must contain between 1 and ${MAX_PDF_PAGES} pages.`,
        422,
      );
    }
  } catch (error) {
    if (error instanceof DocumentEnvelopeError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/password/i.test(message)) {
      throw new DocumentEnvelopeError(
        "PASSWORD_PROTECTED_FILE",
        "Password-protected PDFs are not supported.",
        422,
      );
    }
    throw new DocumentEnvelopeError("FILE_CORRUPTED", "The PDF could not be safely parsed.", 422);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function assertImageEnding(plaintext: Buffer, mimeType: ValidatedEncryptedEnvelope["originalMimeType"]) {
  if (mimeType === "image/jpeg" && !plaintext.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) {
    throw new DocumentEnvelopeError("FILE_CORRUPTED", "The JPEG is truncated.", 422);
  }
  if (
    mimeType === "image/png" &&
    !plaintext.subarray(-12).equals(
      Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
    )
  ) {
    throw new DocumentEnvelopeError("FILE_CORRUPTED", "The PNG is truncated.", 422);
  }
  if (
    mimeType === "image/webp" &&
    (plaintext.length < 12 || plaintext.readUInt32LE(4) + 8 !== plaintext.length)
  ) {
    throw new DocumentEnvelopeError("FILE_CORRUPTED", "The WebP container length is invalid.", 422);
  }
}

async function validateImage(
  plaintext: Buffer,
  mimeType: ValidatedEncryptedEnvelope["originalMimeType"],
) {
  const signatureMatches =
    (mimeType === "image/jpeg" &&
      plaintext[0] === 0xff &&
      plaintext[1] === 0xd8 &&
      plaintext[2] === 0xff) ||
    (mimeType === "image/png" &&
      plaintext.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )) ||
    (mimeType === "image/webp" &&
      plaintext.subarray(0, 4).toString("latin1") === "RIFF" &&
      plaintext.subarray(8, 12).toString("latin1") === "WEBP");
  if (!signatureMatches) {
    throw new DocumentEnvelopeError(
      "FILE_SIGNATURE_MISMATCH",
      "The image signature does not match its declared type.",
      422,
    );
  }
  assertImageEnding(plaintext, mimeType);
  try {
    const image = sharp(plaintext, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_IMAGE_WIDTH ||
      metadata.height > MAX_IMAGE_HEIGHT ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS
    ) {
      throw new DocumentEnvelopeError(
        "UNSAFE_FILE",
        "The image dimensions exceed LifePack's safe decoding limits.",
        422,
      );
    }
    await image.resize({ width: 1, height: 1, fit: "inside" }).toBuffer();
  } catch (error) {
    if (error instanceof DocumentEnvelopeError) throw error;
    throw new DocumentEnvelopeError("FILE_CORRUPTED", "The image could not be safely decoded.", 422);
  }
}

export async function withIsolatedPlaintextFile<T>(
  plaintext: Buffer,
  extension: string,
  callback: (filePath: string) => Promise<T>,
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lifepack-document-"));
  const filePath = path.join(directory, `document${extension}`);
  try {
    await fs.chmod(directory, 0o700);
    await fs.writeFile(filePath, plaintext, { flag: "wx", mode: 0o600 });
    return await callback(filePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function validateDecryptedDocument(
  plaintext: Buffer,
  envelope: Pick<
    ValidatedEncryptedEnvelope,
    "originalFilename" | "originalMimeType" | "originalSize"
  >,
) {
  if (!plaintext.length || plaintext.length !== envelope.originalSize) {
    throw new DocumentEnvelopeError("FILE_CORRUPTED", "The decrypted document size is invalid.", 422);
  }
  if (plaintext.includes(EICAR_MARKER) || plaintext.subarray(0, 2).toString("latin1") === "MZ") {
    throw new DocumentEnvelopeError("MALWARE_DETECTED", "The document did not pass security scanning.", 422);
  }

  const extension = path.extname(envelope.originalFilename).toLowerCase();
  const expected: Record<ValidatedEncryptedEnvelope["originalMimeType"], string[]> = {
    "application/pdf": [".pdf"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
  };
  if (!expected[envelope.originalMimeType].includes(extension)) {
    throw new DocumentEnvelopeError(
      "FILE_SIGNATURE_MISMATCH",
      "The filename extension does not match the validated document type.",
      422,
    );
  }

  if (envelope.originalMimeType === "application/pdf") {
    await validatePdf(plaintext);
  } else {
    await validateImage(plaintext, envelope.originalMimeType);
  }

  const scanner = loadMalwareScanner();
  if (scanner) {
    await withIsolatedPlaintextFile(plaintext, extension, (filePath) => scanner.scanFile(filePath));
  }
}
