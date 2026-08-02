import fs from "node:fs/promises";
import path from "node:path";

import type { FileSignature, SupportedDocumentKind, UploadedDocumentFile } from "../types";

const signatures = [
  { mimeType: "application/pdf", kind: "pdf" as const, matches: (buffer: Buffer) => buffer.subarray(0, 4).toString() === "%PDF" },
  { mimeType: "image/png", kind: "image" as const, matches: (buffer: Buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mimeType: "image/jpeg", kind: "image" as const, matches: (buffer: Buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  { mimeType: "image/webp", kind: "image" as const, matches: (buffer: Buffer) => buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP" },
  { mimeType: "image/bmp", kind: "image" as const, matches: (buffer: Buffer) => buffer.subarray(0, 2).toString() === "BM" },
  { mimeType: "image/tiff", kind: "image" as const, matches: (buffer: Buffer) => ["II*\u0000", "MM\u0000*"].includes(buffer.subarray(0, 4).toString("latin1")) },
  { mimeType: "application/zip", kind: "office" as const, matches: (buffer: Buffer) => buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  { mimeType: "application/rtf", kind: "office" as const, matches: (buffer: Buffer) => buffer.subarray(0, 5).toString("latin1") === "{\\rtf" },
];

const extensionKind = new Map<string, SupportedDocumentKind>([
  [".jpg", "image"],
  [".jpeg", "image"],
  [".png", "image"],
  [".webp", "image"],
  [".heic", "image"],
  [".bmp", "image"],
  [".tif", "image"],
  [".tiff", "image"],
  [".pdf", "pdf"],
  [".doc", "office"],
  [".docx", "office"],
  [".rtf", "office"],
  [".txt", "text"],
]);

const extensionMimeType = new Map<string, string>([
  [".txt", "text/plain"],
  [".rtf", "application/rtf"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".heic", "image/heic"],
]);

const executableExtensions = new Set([
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".exe",
  ".js",
  ".msi",
  ".ps1",
  ".scr",
  ".sh",
  ".vbs",
]);

function mimeKind(mimeType: string): SupportedDocumentKind | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/")) return "text";
  if (
    mimeType.includes("word") ||
    mimeType.includes("rtf") ||
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "office";
  }

  return null;
}

export async function detectFileSignature(file: UploadedDocumentFile): Promise<FileSignature> {
  const extension = path.extname(file.originalName).toLowerCase();
  const header = await fs.open(file.path, "r").then(async (handle) => {
    try {
      const buffer = Buffer.alloc(32);
      await handle.read(buffer, 0, buffer.length, 0);
      return buffer;
    } finally {
      await handle.close();
    }
  });

  if (executableExtensions.has(extension) || header.subarray(0, 2).toString() === "MZ") {
    return {
      extension,
      mimeType: file.mimeType,
      detectedMimeType: "application/x-msdownload",
      kind: "text",
      isSupported: false,
      warnings: [{ code: "UNSUPPORTED_EXECUTABLE", message: "Executable uploads are not allowed." }],
    };
  }

  const matchedSignature = signatures.find((signature) => signature.matches(header));
  const declaredKind = mimeKind(file.mimeType);
  const fallbackKind = extensionKind.get(extension);
  const kind = matchedSignature?.kind ?? declaredKind ?? fallbackKind ?? "text";
  const detectedMimeType = matchedSignature?.mimeType ?? extensionMimeType.get(extension) ?? file.mimeType;
  const isSupported = Boolean(matchedSignature || declaredKind || fallbackKind);
  const warnings = [];

  if (matchedSignature && declaredKind && matchedSignature.kind !== declaredKind) {
    warnings.push({
      code: "MIME_MISMATCH",
      message: `Declared MIME type ${file.mimeType} does not match detected ${matchedSignature.mimeType}.`,
    });
  }

  if (!isSupported) {
    warnings.push({
      code: "UNSUPPORTED_TYPE",
      message: "This file type is not supported by the ingestion pipeline.",
    });
  }

  return {
    extension,
    mimeType: file.mimeType,
    detectedMimeType,
    kind,
    isSupported,
    warnings,
  };
}
