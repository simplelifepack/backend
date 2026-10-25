import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import type { RequestHandler } from "express";
import { createAdmissionLimit } from "./resourceLimits";
import { pipeline } from "node:stream";
import { AES_GCM_TAG_BYTES, MAX_DOCUMENT_UPLOAD_BYTES } from "../services/documentUploadLimits";

const defaultUploadsDir = process.env.VERCEL ? path.join("/tmp", "readiness-uploads") : path.resolve(process.cwd(), "uploads");
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || defaultUploadsDir);
const temporaryUploadsDir = path.join(uploadsDir, "tmp");
const permanentUploadsDir = path.join(uploadsDir, "documents");

for (const directory of [uploadsDir, temporaryUploadsDir, permanentUploadsDir]) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(directory, 0o700);
}

const storage: multer.StorageEngine = {
  _handleFile: (_req, file, cb) => {
    const filename = `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
    const filePath = path.join(temporaryUploadsDir, filename);
    const output = fs.createWriteStream(filePath, { flags: "wx", mode: 0o600 });
    pipeline(file.stream, output, error => {
      if (error) {
        fs.unlink(filePath, () => cb(error));
        return;
      }
      cb(null, { destination: temporaryUploadsDir, filename, path: filePath, size: output.bytesWritten });
    });
  },
  _removeFile: (_req, file, cb) => {
    fs.unlink(file.path, cb);
  },
};

const allowedMimeTypes = new Set([
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/bmp",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
  "text/plain",
]);

const allowedExtensions = new Set([
  ".bmp",
  ".doc",
  ".docx",
  ".heic",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".rtf",
  ".tif",
  ".tiff",
  ".txt",
  ".webp",
]);

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_DOCUMENT_UPLOAD_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.has(extension) || !allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error("Unsupported file type."));
    }

    return cb(null, true);
  },
});

// Bound ciphertext while it arrives, before envelopes or file signatures are parsed.
const requestBytes = new WeakMap<object, number>();
const maxEncryptedBytes = MAX_DOCUMENT_UPLOAD_BYTES + 50 * AES_GCM_TAG_BYTES;
const boundedMemoryStorage: multer.StorageEngine = {
  _handleFile(req, file, cb) {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      req.removeListener("aborted", abort);
      file.stream.removeListener("data", data);
      file.stream.removeListener("end", end);
      file.stream.removeListener("error", fail);
      const buffer = error ? undefined : Buffer.concat(chunks, size);
      chunks.length = 0;
      if (error) { cb(error); file.stream.resume(); }
      else cb(null, { buffer, size });
    };
    const abort = () => finish(new Error("Upload cancelled."));
    const fail = (error: Error) => finish(error);
    const end = () => finish();
    const data = (chunk: Buffer) => {
      const total = (requestBytes.get(req) ?? 0) + chunk.length;
      if (size + chunk.length > MAX_DOCUMENT_UPLOAD_BYTES + AES_GCM_TAG_BYTES) return finish(new multer.MulterError("LIMIT_FILE_SIZE"));
      if (total > maxEncryptedBytes) return finish(Object.assign(new Error("Upload exceeds aggregate limit."), { statusCode: 413 }));
      requestBytes.set(req, total);
      chunks.push(chunk);
      size += chunk.length;
    };
    req.once("aborted", abort);
    file.stream.on("data", data);
    file.stream.once("end", end);
    file.stream.once("error", fail);
  },
  _removeFile(_req, file, cb) { delete (file as Partial<Express.Multer.File>).buffer; cb(null); },
};
const encryptedParser = multer({
  storage: boundedMemoryStorage,
  limits: {
    fileSize: MAX_DOCUMENT_UPLOAD_BYTES + AES_GCM_TAG_BYTES + 1,
    files: 50,
    fields: 2,
    parts: 52,
    fieldSize: 256 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!["encryptedFile", "encryptedFiles"].includes(file.fieldname) || file.mimetype !== "application/octet-stream") {
      return cb(new Error("INVALID_ENCRYPTION_ENVELOPE"));
    }
    return cb(null, true);
  },
});

// Keep admission through validation/AI and response streaming, not just parsing.
const admitEncryptedUpload = createAdmissionLimit(4);
export const encryptedUpload = {
  array(field: string, count: number): RequestHandler {
    const parse = encryptedParser.array(field, count);
    return (req, res, next) => admitEncryptedUpload(req, res, () => parse(req, res, error => {
      // Multer 1 unpipes Busboy on failure; drain the remaining request so the
      // rejection does not reset a reused HTTP connection or retain input.
      if (error) req.resume();
      next(error);
    }));
  },
};

export { uploadsDir, temporaryUploadsDir, permanentUploadsDir };
