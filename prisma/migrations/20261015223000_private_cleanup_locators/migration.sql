-- Storage cleanup locators can contain historical filenames. Persist ciphertext
-- and an owner-scoped equality token used for byte-accounting deduplication.
ALTER TABLE "storage_cleanup" ADD COLUMN "encryptedKey" TEXT;
ALTER TABLE "storage_cleanup" ADD CONSTRAINT "storage_cleanup_private_v2" CHECK (
  "encryptedKey" IS NOT NULL
  AND "encryptedKey" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$'
  AND "storageKey" ~ '^hmac:v2:[0-9a-f]{64}$'
) NOT VALID;
