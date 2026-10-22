-- Owner-scoped generated/custom catalogue content. Historical ai rows are quarantined.
ALTER TABLE "Requirement" ADD COLUMN "privacyOwnerId" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_slug" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_title" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_subtitle" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_category" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_aliases" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_description" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_keywords" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_searchMetadata" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_sourceType" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_sourceName" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_sourceTitle" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_sourceUrl" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_lastCheckedAt" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_verificationSources" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_lastVerifiedAt" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "private_verificationStatus" TEXT;
ALTER TABLE "ReadinessPack" ADD CONSTRAINT "ReadinessPack_private_v2" CHECK ("createdBy" = 'seed' OR (
  ("private_slug" IS NOT NULL AND "private_slug" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("slug" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_title" IS NOT NULL AND "private_title" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("title" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_subtitle" IS NOT NULL AND "private_subtitle" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("subtitle" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_category" IS NOT NULL AND "private_category" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("category" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_aliases" IS NOT NULL AND "private_aliases" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("aliases") = 0)
  AND ("private_description" IS NOT NULL AND "private_description" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("description" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_keywords" IS NOT NULL AND "private_keywords" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("keywords") = 0)
  AND ("private_searchMetadata" IS NOT NULL AND "private_searchMetadata" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("searchMetadata" IS NULL)
  AND ("private_sourceType" IS NOT NULL AND "private_sourceType" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceType" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_sourceName" IS NOT NULL AND "private_sourceName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_sourceTitle" IS NOT NULL AND "private_sourceTitle" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceTitle" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_sourceUrl" IS NOT NULL AND "private_sourceUrl" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceUrl" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_lastCheckedAt" IS NOT NULL AND "private_lastCheckedAt" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("lastCheckedAt" IS NULL)
  AND ("private_verificationSources" IS NOT NULL AND "private_verificationSources" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("verificationSources" IS NULL)
  AND ("private_lastVerifiedAt" IS NOT NULL AND "private_lastVerifiedAt" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("lastVerifiedAt" IS NULL)
  AND ("private_verificationStatus" IS NOT NULL AND "private_verificationStatus" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("verificationStatus" ~ '^hmac:v2:[0-9a-f]{64}$')
)) NOT VALID;
ALTER TABLE "Requirement" ADD COLUMN "private_title" TEXT;
ALTER TABLE "Requirement" ADD COLUMN "private_documentType" TEXT;
ALTER TABLE "Requirement" ADD COLUMN "private_owner" TEXT;
ALTER TABLE "Requirement" ADD COLUMN "private_metadata" TEXT;
ALTER TABLE "Requirement" ADD COLUMN "private_description" TEXT;
ALTER TABLE "Requirement" ADD COLUMN "private_required" TEXT;
ALTER TABLE "Requirement" ADD COLUMN "private_group" TEXT;
ALTER TABLE "Requirement" ADD COLUMN "private_acceptedDocumentTypes" TEXT;
ALTER TABLE "Requirement" ADD COLUMN "private_alternativeLabels" TEXT;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_private_v2" CHECK (COALESCE("privacyOwnerId" = 'seed', false) OR (
  ("private_title" IS NOT NULL AND "private_title" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("title" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_documentType" IS NOT NULL AND "private_documentType" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("documentType" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_owner" IS NOT NULL AND "private_owner" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("owner" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_metadata" IS NOT NULL AND "private_metadata" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("metadata" IS NULL)
  AND ("private_description" IS NOT NULL AND "private_description" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("description" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_required" IS NOT NULL AND "private_required" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("required" = false)
  AND ("private_group" IS NOT NULL AND "private_group" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("group" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_acceptedDocumentTypes" IS NOT NULL AND "private_acceptedDocumentTypes" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("acceptedDocumentTypes") = 0)
  AND ("private_alternativeLabels" IS NOT NULL AND "private_alternativeLabels" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("alternativeLabels") = 0)
)) NOT VALID;
ALTER TABLE "account_export_jobs" ADD COLUMN "private_errorMessage" TEXT;
ALTER TABLE "account_export_jobs" ADD CONSTRAINT "account_export_jobs_private_v2" CHECK ((
  ("private_errorMessage" IS NOT NULL AND "private_errorMessage" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("errorMessage" ~ '^hmac:v2:[0-9a-f]{64}$')
)) NOT VALID;

-- Bind public/private child provenance to its actual parent, including raw writes.
CREATE UNIQUE INDEX "ReadinessPack_id_createdBy_key" ON "ReadinessPack"("id", "createdBy");
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_privacy_owner_fkey" FOREIGN KEY ("packId", "privacyOwnerId") REFERENCES "ReadinessPack"("id", "createdBy") ON UPDATE CASCADE ON DELETE CASCADE NOT VALID;
