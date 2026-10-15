-- Hand-cleaned: `prisma migrate dev --create-only` generated DROP INDEX
-- statements for ~16 unrelated indexes due to pre-existing drift between
-- schema.prisma's index annotations and the already-applied migration
-- history (same issue noted in prior migrations this session). Keeping only
-- the actual change.

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
