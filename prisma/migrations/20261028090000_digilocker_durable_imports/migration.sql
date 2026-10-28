ALTER TABLE "digilocker_consent_sessions"
  ADD COLUMN "encryptedProgress" TEXT,
  ADD COLUMN "importLeaseToken" TEXT,
  ADD COLUMN "importLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "importAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "importNextAttemptAt" TIMESTAMP(3);
CREATE INDEX "digilocker_import_queue_idx"
  ON "digilocker_consent_sessions"("status", "importNextAttemptAt", "importLeaseUntil");
-- Old IMPORTING sessions carry their last explicit consent and progress in
-- encryptedPayload; a worker resumes that batch without another download of
-- documents already committed. No private payload is decrypted by migration.
UPDATE "digilocker_consent_sessions" SET "importNextAttemptAt" = timezone('UTC', CURRENT_TIMESTAMP)
  WHERE "status" = 'IMPORTING';
ALTER TABLE "digilocker_consent_sessions" ADD CONSTRAINT "digilocker_progress_ciphertext"
CHECK ("encryptedProgress" IS NULL OR "encryptedProgress" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$');
