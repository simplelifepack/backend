ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recoverySetupComplete" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "recoverySetupComplete" = true WHERE "recoveryVerifier" IS NOT NULL;
