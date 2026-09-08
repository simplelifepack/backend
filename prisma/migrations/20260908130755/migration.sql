-- DropForeignKey
ALTER TABLE "storage_cleanup" DROP CONSTRAINT "storage_cleanup_ownerUserId_fkey";

-- DropForeignKey
ALTER TABLE "user_ai_usage" DROP CONSTRAINT "user_ai_usage_userId_fkey";

-- AlterTable
ALTER TABLE "user_ai_usage" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "user_ai_usage" ADD CONSTRAINT "user_ai_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_cleanup" ADD CONSTRAINT "storage_cleanup_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
