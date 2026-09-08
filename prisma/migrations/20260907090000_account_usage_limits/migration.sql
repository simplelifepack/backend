BEGIN;
-- Minimal usage tiers; existing billing tables were removed by the prior migration.
-- No surviving authoritative paid status exists: all existing/new users default free.
CREATE TYPE "AccountTier" AS ENUM ('free', 'paid');
ALTER TABLE "User" ADD COLUMN "accountTier" "AccountTier" NOT NULL DEFAULT 'free';
CREATE TABLE "user_ai_usage" (
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "period" TEXT NOT NULL CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "actionCount" INTEGER NOT NULL DEFAULT 0 CHECK ("actionCount" >= 0),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "period")
);

COMMIT;
