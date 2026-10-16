-- Expansion only: existing rows are preserved. NOT VALID still rejects new or
-- updated plaintext rows. Pause queue writes before applying, backfill using the
-- documented command, then validate the constraint. Never run old writers again.
ALTER TABLE "account_export_jobs" ADD COLUMN "archiveEncryptionVersion" INTEGER;
ALTER TABLE "CustomPackageGenerationJob" ADD CONSTRAINT "private_job_ciphertext_v2"
CHECK (
  ("packageType" IS NULL OR "packageType" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("statusMessage" IS NULL OR "statusMessage" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("errorMessage" IS NULL OR "errorMessage" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("errorCode" IS NULL OR "errorCode" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("confidence" IS NULL OR "confidence" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("disclaimer" IS NULL OR "disclaimer" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("draft" IS NULL OR (jsonb_typeof("draft") = 'string' AND ("draft" #>> '{}') ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$'))
  AND (cardinality("documentLabels") = 1 AND "documentLabels"[1] ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("dedupeKey" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
