-- Hand-cleaned: `prisma migrate dev --create-only` generated DROP INDEX
-- statements for ~16 unrelated indexes due to pre-existing drift between
-- schema.prisma's index annotations and the already-applied migration
-- history (same issue noted in 20261011155518_add_admin_console_phase0 and
-- 20261012101407_add_user_suspension). Keeping only the actual change.

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('key_rewrap', 'storage_audit', 'package_source_backfill');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('running', 'paused', 'completed', 'failed');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'running',
    "cursor" TEXT,
    "totalCount" INTEGER,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "params" JSONB,
    "resultSummary" JSONB,
    "startedByAdminId" TEXT,
    "approvedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");
