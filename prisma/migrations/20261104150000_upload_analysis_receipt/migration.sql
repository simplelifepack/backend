-- Additive: old/import uploads continue to support manual save.
ALTER TABLE "TemporaryUpload"
  ADD COLUMN "analysis" JSONB,
  ADD COLUMN "private_analysis" TEXT,
  ADD COLUMN "savedDocumentId" TEXT;
