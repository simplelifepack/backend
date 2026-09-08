import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";

const defaultUploadsDir = process.env.VERCEL ? path.join("/tmp", "readiness-uploads") : path.resolve(process.cwd(), "uploads");
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || defaultUploadsDir);
const temporaryUploadsDir = path.join(uploadsDir, "tmp");
const permanentUploadsDir = path.join(uploadsDir, "documents");

for (const directory of [uploadsDir, temporaryUploadsDir, permanentUploadsDir]) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, temporaryUploadsDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  },
});

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
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.has(extension) || !allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error("Unsupported file type."));
    }

    return cb(null, true);
  },
});

export const encryptedUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024 + 16,
    files: 10,
    fields: 2,
    parts: 12,
  },
  fileFilter: (_req, file, cb) => {
    if (!["encryptedFile", "encryptedFiles"].includes(file.fieldname) || file.mimetype !== "application/octet-stream") {
      return cb(new Error("INVALID_ENCRYPTION_ENVELOPE"));
    }
    return cb(null, true);
  },
});

export { uploadsDir, temporaryUploadsDir, permanentUploadsDir };
