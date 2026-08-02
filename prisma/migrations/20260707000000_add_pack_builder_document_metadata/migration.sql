ALTER TABLE "Document" ADD COLUMN "displayName" TEXT;
ALTER TABLE "Document" ADD COLUMN "ownerProfileId" TEXT;
ALTER TABLE "Document" ADD COLUMN "uniqueIdentifier" TEXT;
ALTER TABLE "Document" ADD COLUMN "extractedKeyFields" JSONB;
ALTER TABLE "Document" ADD COLUMN "rawText" TEXT;

CREATE INDEX "Document_ownerProfileId_idx" ON "Document"("ownerProfileId");
CREATE INDEX "Document_uniqueIdentifier_idx" ON "Document"("uniqueIdentifier");
