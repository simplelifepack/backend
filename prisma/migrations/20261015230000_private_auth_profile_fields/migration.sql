-- Stop all auth/profile writers before expansion, backfill and validation.
ALTER TABLE "User" ADD COLUMN "private_name" TEXT;
ALTER TABLE "User" ADD COLUMN "private_email" TEXT;
ALTER TABLE "User" ADD COLUMN "private_country" TEXT;
ALTER TABLE "User" ADD COLUMN "private_passportCountry" TEXT;
ALTER TABLE "User" ADD COLUMN "private_homeCurrency" TEXT;
ALTER TABLE "User" ADD COLUMN "private_appearance" TEXT;
ALTER TABLE "User" ADD COLUMN "private_aiProcessingEnabled" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_private_v2" CHECK (
  ("private_name" IS NOT NULL AND "private_name" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("name" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_email" IS NOT NULL AND "private_email" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("email" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_country" IS NOT NULL AND "private_country" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("country" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_passportCountry" IS NOT NULL AND "private_passportCountry" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("passportCountry" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_homeCurrency" IS NOT NULL AND "private_homeCurrency" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("homeCurrency" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_appearance" IS NOT NULL AND "private_appearance" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("appearance" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_aiProcessingEnabled" IS NOT NULL AND "private_aiProcessingEnabled" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("aiProcessingEnabled" = false)
) NOT VALID;
ALTER TABLE "signup_verifications" ADD COLUMN "private_email" TEXT;
ALTER TABLE "signup_verifications" ADD COLUMN "private_name" TEXT;
ALTER TABLE "signup_verifications" ADD CONSTRAINT "signup_verifications_private_v2" CHECK (
  ("private_email" IS NOT NULL AND "private_email" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("email" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_name" IS NOT NULL AND "private_name" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("name" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
ALTER TABLE "ExternalIdentity" ADD COLUMN "private_providerAccountId" TEXT;
ALTER TABLE "ExternalIdentity" ADD COLUMN "private_avatarUrl" TEXT;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_private_v2" CHECK (
  ("private_providerAccountId" IS NOT NULL AND "private_providerAccountId" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("providerAccountId" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_avatarUrl" IS NOT NULL AND "private_avatarUrl" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("avatarUrl" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
