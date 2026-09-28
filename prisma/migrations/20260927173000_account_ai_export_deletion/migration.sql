ALTER TABLE "User"
  ADD COLUMN "aiProcessingEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN "scheduledDeletionAt" TIMESTAMP(3);

CREATE INDEX "User_scheduledDeletionAt_idx" ON "User"("scheduledDeletionAt");

CREATE TABLE "account_export_jobs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "storageKey" TEXT,
  "fileName" TEXT,
  "sizeBytes" INTEGER,
  "errorMessage" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "preparedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "downloadedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "account_export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_export_jobs_userId_status_idx" ON "account_export_jobs"("userId", "status");
CREATE INDEX "account_export_jobs_expiresAt_idx" ON "account_export_jobs"("expiresAt");

ALTER TABLE "account_export_jobs"
  ADD CONSTRAINT "account_export_jobs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
