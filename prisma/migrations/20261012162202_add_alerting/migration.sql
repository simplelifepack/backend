-- Hand-cleaned: `prisma migrate dev --create-only` generated DROP INDEX
-- statements for ~16 unrelated indexes due to pre-existing drift between
-- schema.prisma's index annotations and the already-applied migration
-- history (same issue noted in prior migrations this session). Keeping only
-- the actual change.

-- CreateEnum
CREATE TYPE "AlertChannelType" AS ENUM ('email', 'webhook');

-- CreateEnum
CREATE TYPE "AlertCondition" AS ENUM ('job_failed');

-- CreateTable
CREATE TABLE "AlertChannel" (
    "id" TEXT NOT NULL,
    "type" "AlertChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "condition" "AlertCondition" NOT NULL,
    "jobType" "JobType",
    "channelId" TEXT NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertRule_condition_enabled_idx" ON "AlertRule"("condition", "enabled");

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "AlertChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
