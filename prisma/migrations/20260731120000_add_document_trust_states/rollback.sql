DROP INDEX IF EXISTS "Document_userScopedDedupHash_idx";
DROP INDEX IF EXISTS "Document_classificationStatus_ownershipStatus_integrityStatus_idx";
DROP INDEX IF EXISTS "Document_targetProfileId_readinessEligible_idx";
DROP INDEX IF EXISTS "Document_ownerProfileId_readinessEligible_idx";
DROP INDEX IF EXISTS "Document_documentTypeCode_idx";

ALTER TABLE "Document"
  DROP COLUMN IF EXISTS "deletedAt",
  DROP COLUMN IF EXISTS "integrityStatus",
  DROP COLUMN IF EXISTS "metadataIntegrityHash",
  DROP COLUMN IF EXISTS "userScopedDedupHash",
  DROP COLUMN IF EXISTS "ciphertextHash",
  DROP COLUMN IF EXISTS "readinessEligible",
  DROP COLUMN IF EXISTS "ownershipMismatchedFields",
  DROP COLUMN IF EXISTS "ownershipMatchedFields",
  DROP COLUMN IF EXISTS "ownershipConfidence",
  DROP COLUMN IF EXISTS "ownershipStatus",
  DROP COLUMN IF EXISTS "classificationSignals",
  DROP COLUMN IF EXISTS "classificationConfidence",
  DROP COLUMN IF EXISTS "classificationStatus",
  DROP COLUMN IF EXISTS "documentTypeCode",
  DROP COLUMN IF EXISTS "targetProfileId";
