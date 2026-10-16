-- Extraction outcomes can disclose medical content; preserve them in authenticated ciphertext.
-- Additive follow-up: never edit the already-applied original privacy migrations.
ALTER TABLE "health_documents" ADD COLUMN "private_processingStatus" TEXT;
ALTER TABLE "health_documents" ADD CONSTRAINT "health_document_outcome_private_v2" CHECK (
  "private_processingStatus" IS NOT NULL
  AND "private_processingStatus" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$'
  AND "processingStatus" ~ '^hmac:v2:[0-9a-f]{64}$'
) NOT VALID;
