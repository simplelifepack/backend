CREATE TYPE "WealthRecordType" AS ENUM ('ASSET', 'LOAN_TAKEN', 'LOAN_GIVEN', 'INSURANCE', 'PAYMENT_PROOF');

CREATE TABLE "wealth_records" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "type" "WealthRecordType" NOT NULL,
  "title" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "notes" TEXT,
  "followUpDate" TIMESTAMP(3),
  "followUpNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wealth_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wealth_record_attachments" (
  "id" TEXT NOT NULL,
  "wealthRecordId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wealth_record_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wealth_records_ownerUserId_type_idx" ON "wealth_records"("ownerUserId", "type");
CREATE INDEX "wealth_records_followUpDate_idx" ON "wealth_records"("followUpDate");
CREATE UNIQUE INDEX "wealth_record_attachments_wealthRecordId_documentId_key" ON "wealth_record_attachments"("wealthRecordId", "documentId");
CREATE INDEX "wealth_record_attachments_documentId_idx" ON "wealth_record_attachments"("documentId");

ALTER TABLE "wealth_records" ADD CONSTRAINT "wealth_records_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wealth_record_attachments" ADD CONSTRAINT "wealth_record_attachments_wealthRecordId_fkey" FOREIGN KEY ("wealthRecordId") REFERENCES "wealth_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wealth_record_attachments" ADD CONSTRAINT "wealth_record_attachments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
