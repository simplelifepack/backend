ALTER TABLE "Requirement"
ADD COLUMN "documentType" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN "owner" TEXT NOT NULL DEFAULT 'self',
ADD COLUMN "metadata" JSONB;

CREATE INDEX "Requirement_documentType_owner_idx" ON "Requirement"("documentType", "owner");
