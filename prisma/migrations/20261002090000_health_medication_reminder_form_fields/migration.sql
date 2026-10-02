-- Add structured schedule fields for manually added and edited medications.
ALTER TABLE "health_medications"
  ADD COLUMN IF NOT EXISTS "whenToTake" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "mealTiming" TEXT,
  ADD COLUMN IF NOT EXISTS "repeatRunsOut" TIMESTAMP(3);

-- Align the database default with Prisma's @updatedAt behavior.
ALTER TABLE "health_medications" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Add structured reminder form fields.
ALTER TABLE "health_reminders"
  ADD COLUMN IF NOT EXISTS "type" TEXT,
  ADD COLUMN IF NOT EXISTS "frequency" TEXT;
