-- Hand-cleaned: `prisma migrate dev --create-only` generated DROP INDEX
-- statements for ~16 unrelated indexes due to pre-existing drift between
-- schema.prisma's index annotations and the already-applied migration
-- history (same issue noted in prior migrations this session). Keeping only
-- the actual change.

-- CreateEnum
CREATE TYPE "EmailLogStatus" AS ENUM ('sent', 'failed');

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipientId" TEXT,
    "status" "EmailLogStatus" NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailLog_template_createdAt_idx" ON "EmailLog"("template", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_recipient_createdAt_idx" ON "EmailLog"("recipient", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_status_createdAt_idx" ON "EmailLog"("status", "createdAt");
