ALTER TABLE "Document"
ADD COLUMN "storageKey" TEXT,
ADD COLUMN "storageBucket" TEXT,
ADD COLUMN "encryptionVersion" INTEGER;

CREATE INDEX "Document_storageKey_idx" ON "Document"("storageKey");
