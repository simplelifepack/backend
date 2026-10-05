CREATE TABLE "CustomPackageGenerationJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "packageType" TEXT NOT NULL,
  "documentLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'queued',
  "statusMessage" TEXT,
  "draft" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "provider429Count" INTEGER NOT NULL DEFAULT 0,
  "hasVerifiedOfficialSource" BOOLEAN NOT NULL DEFAULT false,
  "confidence" TEXT,
  "disclaimer" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "processingMs" INTEGER,
  "aiMs" INTEGER,
  "saveMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomPackageGenerationJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomPackageGenerationJob_userId_dedupeKey_status_idx"
  ON "CustomPackageGenerationJob"("userId", "dedupeKey", "status");

CREATE INDEX "CustomPackageGenerationJob_status_queuedAt_idx"
  ON "CustomPackageGenerationJob"("status", "queuedAt");

CREATE INDEX "CustomPackageGenerationJob_leaseExpiresAt_idx"
  ON "CustomPackageGenerationJob"("leaseExpiresAt");

ALTER TABLE "CustomPackageGenerationJob"
  ADD CONSTRAINT "CustomPackageGenerationJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
