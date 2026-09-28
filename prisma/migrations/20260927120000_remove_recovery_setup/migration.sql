ALTER TABLE "User" DROP COLUMN IF EXISTS "recoveryVerifier";
ALTER TABLE "User" DROP COLUMN IF EXISTS "recoveryVersion";
ALTER TABLE "User" DROP COLUMN IF EXISTS "recoveryCreatedAt";
ALTER TABLE "User" DROP COLUMN IF EXISTS "recoverySetupComplete";
