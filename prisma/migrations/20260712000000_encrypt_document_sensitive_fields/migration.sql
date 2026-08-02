-- Add a keyed lookup hash for duplicate detection while keeping the readable
-- unique identifier encrypted in the existing uniqueIdentifier column.
ALTER TABLE "Document" ADD COLUMN "uniqueIdentifierHash" TEXT;

CREATE INDEX "Document_uniqueIdentifierHash_idx" ON "Document"("uniqueIdentifierHash");
