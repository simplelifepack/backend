ALTER TABLE "DocumentFile"
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'upload',
  ADD COLUMN "pageCount" INTEGER,
  ADD COLUMN "storageBucket" TEXT,
  ADD COLUMN "storageMimeType" TEXT,
  ADD COLUMN "originalSha256" TEXT,
  ADD COLUMN "encryptedSha256" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

INSERT INTO "DocumentFile" (
  id,
  "documentId",
  "pageIndex",
  "sourceType",
  "originalName",
  "mimeType",
  size,
  "storageKey",
  "storedName",
  "encryptionVersion",
  "contentAlgorithm",
  "keyAlgorithm",
  "keyId",
  "keyVersion",
  "encryptionIv",
  "wrappedKey",
  "encryptedSize",
  "ciphertextHash",
  "storageBucket",
  "storageMimeType",
  "originalSha256",
  "encryptedSha256",
  "createdAt",
  "updatedAt"
)
SELECT
  concat('docfile_', replace(gen_random_uuid()::text, '-', '')),
  d.id,
  0,
  CASE WHEN d."sourceProvider" = 'GOOGLE_DRIVE' THEN 'external' ELSE 'upload' END,
  d."originalName",
  d."mimeType",
  d.size,
  COALESCE(d."storageKey", d.path),
  d."storedName",
  d."encryptionVersion",
  d."contentAlgorithm",
  d."keyAlgorithm",
  d."keyId",
  d."keyVersion",
  d."encryptionIv",
  d."wrappedKey",
  d."encryptedSize",
  COALESCE(d."ciphertextHash", d."encryptedSha256"),
  d."storageBucket",
  d."storageMimeType",
  d."originalSha256",
  d."encryptedSha256",
  d."createdAt",
  d."updatedAt"
FROM "Document" d
WHERE COALESCE(d."storageKey", d.path) IS NOT NULL
  AND COALESCE(d."storageKey", d.path) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "DocumentFile" f WHERE f."documentId" = d.id
  );

CREATE INDEX "DocumentFile_documentId_pageIndex_idx" ON "DocumentFile"("documentId", "pageIndex");

ALTER TABLE "DocumentFile" ALTER COLUMN "updatedAt" DROP DEFAULT;
