-- Document/page privacy expansion. Stop writers before applying, backfill, then validate.
ALTER TABLE "Document" ADD COLUMN "storageUsageKey" TEXT;
ALTER TABLE "DocumentFile" ADD COLUMN "privacyOwnerId" TEXT;
ALTER TABLE "DocumentFile" ADD COLUMN "storageUsageKey" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_title" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_displayName" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_uniqueIdentifier" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_uniqueIdentifierHash" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_extractedKeyFields" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_rawText" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_originalName" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_storedName" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_path" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_storageKey" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_wrappedKey" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_originalSha256" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_documentType" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_normalizedType" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_documentTypeCode" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_category" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_confidence" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_classificationConfidence" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_classificationSignals" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_ownershipStatus" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_ownershipConfidence" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_ownershipMatchedFields" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_ownershipMismatchedFields" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_readinessEligible" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_fields" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_contentHash" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_sourceMessageId" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_sourceAttachmentId" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_driveFileId" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_sourceModifiedTime" TEXT;
ALTER TABLE "Document" ADD COLUMN "private_sourceChecksum" TEXT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_private_v2" CHECK (
  ("private_title" IS NOT NULL AND "private_title" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("title" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_displayName" IS NOT NULL AND "private_displayName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("displayName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_uniqueIdentifier" IS NOT NULL AND "private_uniqueIdentifier" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("uniqueIdentifier" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_uniqueIdentifierHash" IS NOT NULL AND "private_uniqueIdentifierHash" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("uniqueIdentifierHash" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_extractedKeyFields" IS NOT NULL AND "private_extractedKeyFields" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("extractedKeyFields" IS NULL)
  AND ("private_rawText" IS NOT NULL AND "private_rawText" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("rawText" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_originalName" IS NOT NULL AND "private_originalName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("originalName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_storedName" IS NOT NULL AND "private_storedName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("storedName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_path" IS NOT NULL AND "private_path" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("path" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_storageKey" IS NOT NULL AND "private_storageKey" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("storageKey" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_wrappedKey" IS NOT NULL AND "private_wrappedKey" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("wrappedKey" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_originalSha256" IS NOT NULL AND "private_originalSha256" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("originalSha256" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_documentType" IS NOT NULL AND "private_documentType" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("documentType" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_normalizedType" IS NOT NULL AND "private_normalizedType" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("normalizedType" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_documentTypeCode" IS NOT NULL AND "private_documentTypeCode" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("documentTypeCode" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_category" IS NOT NULL AND "private_category" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("category" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_confidence" IS NOT NULL AND "private_confidence" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("confidence" = 0)
  AND ("private_classificationConfidence" IS NOT NULL AND "private_classificationConfidence" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("classificationConfidence" = 0)
  AND ("private_classificationSignals" IS NOT NULL AND "private_classificationSignals" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("classificationSignals" IS NULL)
  AND ("private_ownershipStatus" IS NOT NULL AND "private_ownershipStatus" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("ownershipStatus" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_ownershipConfidence" IS NOT NULL AND "private_ownershipConfidence" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("ownershipConfidence" = 0)
  AND ("private_ownershipMatchedFields" IS NOT NULL AND "private_ownershipMatchedFields" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("ownershipMatchedFields") = 0)
  AND ("private_ownershipMismatchedFields" IS NOT NULL AND "private_ownershipMismatchedFields" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("ownershipMismatchedFields") = 0)
  AND ("private_readinessEligible" IS NOT NULL AND "private_readinessEligible" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("readinessEligible" = false)
  AND ("private_fields" IS NOT NULL AND "private_fields" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("fields" = '{}'::jsonb)
  AND ("private_contentHash" IS NOT NULL AND "private_contentHash" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("contentHash" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_sourceMessageId" IS NOT NULL AND "private_sourceMessageId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceMessageId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_sourceAttachmentId" IS NOT NULL AND "private_sourceAttachmentId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceAttachmentId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_driveFileId" IS NOT NULL AND "private_driveFileId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("driveFileId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_sourceModifiedTime" IS NOT NULL AND "private_sourceModifiedTime" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceModifiedTime" IS NULL)
  AND ("private_sourceChecksum" IS NOT NULL AND "private_sourceChecksum" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceChecksum" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
ALTER TABLE "DocumentFile" ADD COLUMN "private_originalName" TEXT;
ALTER TABLE "DocumentFile" ADD COLUMN "private_storageKey" TEXT;
ALTER TABLE "DocumentFile" ADD COLUMN "private_storedName" TEXT;
ALTER TABLE "DocumentFile" ADD COLUMN "private_wrappedKey" TEXT;
ALTER TABLE "DocumentFile" ADD COLUMN "private_originalSha256" TEXT;
ALTER TABLE "DocumentFile" ADD CONSTRAINT "DocumentFile_private_v2" CHECK (
  ("private_originalName" IS NOT NULL AND "private_originalName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("originalName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_storageKey" IS NOT NULL AND "private_storageKey" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("storageKey" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_storedName" IS NOT NULL AND "private_storedName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("storedName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_wrappedKey" IS NOT NULL AND "private_wrappedKey" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("wrappedKey" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_originalSha256" IS NOT NULL AND "private_originalSha256" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("originalSha256" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
CREATE UNIQUE INDEX "Document_id_ownerProfileId_key" ON "Document"(id, "ownerProfileId");
ALTER TABLE "DocumentFile" ADD CONSTRAINT "DocumentFile_private_owner_fk" FOREIGN KEY ("documentId", "privacyOwnerId") REFERENCES "Document"(id, "ownerProfileId") ON DELETE CASCADE NOT VALID;
