import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { pipeline } from "node:stream";
import { AsyncResource } from "node:async_hooks";
import type { RequestHandler } from "express";
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

const encryptedMultipart = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_UPLOAD_BYTES + AES_GCM_TAG_BYTES,
    files: 50,
    fields: 2,
    parts: 52,
  },
  fileFilter: (_req, file, cb) => {
    if (!["encryptedFile", "encryptedFiles"].includes(file.fieldname) || file.mimetype !== "application/octet-stream") {
      return cb(new Error("INVALID_ENCRYPTION_ENVELOPE"));
    }
    return cb(null, true);
  },
});

// Incoming stream events can run outside requireAuth's AsyncLocalStorage scope.
// Bind continuation at entry so private ownership checks retain this request's
// verified identity, including parser failures and multi-chunk uploads.
export const encryptedUpload = {
  array(fieldName: string, maxCount?: number): RequestHandler {
    const parse = encryptedMultipart.array(fieldName, maxCount);
    return (req, res, next) => parse(req, res, AsyncResource.bind(next));
  },
};

export { uploadsDir, temporaryUploadsDir, permanentUploadsDir };
