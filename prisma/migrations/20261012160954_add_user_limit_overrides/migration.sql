-- Hand-cleaned: `prisma migrate dev --create-only` generated DROP INDEX
-- statements for ~16 unrelated indexes due to pre-existing drift between
-- schema.prisma's index annotations and the already-applied migration
-- history (same issue noted in prior migrations this session). Keeping only
-- the actual change.

-- CreateTable
CREATE TABLE "UserLimitOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageLimitBytes" INTEGER,
    "aiActionLimit" INTEGER,
    "reason" TEXT NOT NULL,
    "grantedByAdminId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserLimitOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserLimitOverride_userId_expiresAt_idx" ON "UserLimitOverride"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "UserLimitOverride" ADD CONSTRAINT "UserLimitOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
