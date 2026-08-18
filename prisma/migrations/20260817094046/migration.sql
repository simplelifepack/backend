-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "trust_member_permissions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "trust_members" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "usage" ALTER COLUMN "updatedAt" DROP DEFAULT;
