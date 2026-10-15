-- AlterEnum
ALTER TYPE "AlertCondition" ADD VALUE 'budget_exceeded';

-- AlterTable
ALTER TABLE "AlertRule" ADD COLUMN     "taskKey" TEXT;
