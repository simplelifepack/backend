ALTER TABLE "health_documents" DROP CONSTRAINT "health_documents_memberId_fkey";
ALTER TABLE "health_documents" ALTER COLUMN "memberId" DROP NOT NULL;
ALTER TABLE "health_documents" ADD COLUMN "patientName" TEXT,
  ADD COLUMN "patientDateOfBirth" TIMESTAMP(3),
  ADD COLUMN "pendingExtraction" JSONB;
ALTER TABLE "health_documents" ADD CONSTRAINT "health_documents_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "health_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
