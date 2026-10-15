-- Hand-cleaned: `prisma migrate dev --create-only` generated DROP INDEX
-- statements for ~20 unrelated indexes due to pre-existing drift between
-- schema.prisma's index annotations and the already-applied migration
-- history (same issue noted in 20261011155518_add_admin_console_phase0).
-- Keeping only the actual change for this migration.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- CreateIndex
CREATE INDEX "User_suspendedAt_idx" ON "User"("suspendedAt");
