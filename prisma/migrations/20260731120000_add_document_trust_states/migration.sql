-- Additive and reversible trust-state migration.
-- Existing records remain available but are deliberately excluded from readiness
-- until ownership and classification have been explicitly re-verified.
ALTER TABLE "Document"
  ADD COLUMN "targetProfileId" TEXT,
  ADD COLUMN "documentTypeCode" TEXT,
  ADD COLUMN "classificationStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "classificationConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "classificationSignals" JSONB,
  ADD COLUMN "ownershipStatus" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "ownershipConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "ownershipMatchedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ownershipMismatchedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "readinessEligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ciphertextHash" TEXT,
  ADD COLUMN "userScopedDedupHash" TEXT,
  ADD COLUMN "metadataIntegrityHash" TEXT,
  ADD COLUMN "integrityStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "Document"
SET
  "documentTypeCode" = COALESCE("normalizedType", lower(regexp_replace("documentType", '[^a-zA-Z0-9]+', '_', 'g'))),
  "classificationStatus" = CASE
    WHEN COALESCE("normalizedType", 'unknown') = 'unknown' THEN 'pending'
    ELSE 'detected'
  END,
  "classificationConfidence" = LEAST(GREATEST("confidence", 0), 100),
  "ownershipStatus" = 'unknown',
  "readinessEligible" = false,
  "ciphertextHash" = "encryptedSha256",
  "integrityStatus" = CASE WHEN "scanStatus" = 'passed' THEN 'passed' ELSE 'pending' END;

CREATE INDEX "Document_documentTypeCode_idx" ON "Document"("documentTypeCode");
CREATE INDEX "Document_ownerProfileId_readinessEligible_idx" ON "Document"("ownerProfileId", "readinessEligible");
CREATE INDEX "Document_targetProfileId_readinessEligible_idx" ON "Document"("targetProfileId", "readinessEligible");
CREATE INDEX "Document_classificationStatus_ownershipStatus_integrityStatus_idx"
  ON "Document"("classificationStatus", "ownershipStatus", "integrityStatus");
CREATE INDEX "Document_userScopedDedupHash_idx" ON "Document"("userScopedDedupHash");

-- Rollback:
-- DROP INDEX ...; ALTER TABLE "Document" DROP COLUMN ...;
-- No legacy columns or data are removed by this migration.
