ALTER TABLE "health_medications" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'continuing';
ALTER TABLE "health_medications" ADD COLUMN IF NOT EXISTS "stoppedAt" TIMESTAMP(3);
ALTER TABLE "health_medications" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "health_medications_userId_memberId_status_idx" ON "health_medications"("userId", "memberId", "status");
