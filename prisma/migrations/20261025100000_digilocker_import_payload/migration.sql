-- Session secrets, provider metadata, copy-consent audit and progress are encrypted
-- with the existing private-data keyring and bound to session + owner.
ALTER TABLE "digilocker_consent_sessions" ADD COLUMN "encryptedPayload" TEXT;
ALTER TABLE "digilocker_consent_sessions" ADD CONSTRAINT "digilocker_payload_ciphertext"
CHECK ("encryptedPayload" IS NULL OR "encryptedPayload" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$');

ALTER TABLE "digilocker_consent_sessions" ADD COLUMN "encryptedCredentials" TEXT;
ALTER TABLE "digilocker_consent_sessions" ADD CONSTRAINT "digilocker_credentials_ciphertext"
CHECK ("encryptedCredentials" IS NULL OR "encryptedCredentials" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$');
