ALTER TABLE "health_medications" ADD COLUMN "repeats" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "health_medications" ADD COLUMN "runsOutAt" TIMESTAMP(3);
ALTER TABLE "health_medications" ALTER COLUMN "sourceDocumentId" DROP NOT NULL;
