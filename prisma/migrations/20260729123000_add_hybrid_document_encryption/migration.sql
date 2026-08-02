ALTER TABLE "Document"
ADD COLUMN "storageMimeType" TEXT,
ADD COLUMN "contentAlgorithm" TEXT,
ADD COLUMN "keyAlgorithm" TEXT,
ADD COLUMN "keyId" TEXT,
ADD COLUMN "keyVersion" INTEGER,
ADD COLUMN "encryptionIv" TEXT,
ADD COLUMN "wrappedKey" TEXT,
ADD COLUMN "originalSha256" TEXT,
ADD COLUMN "encryptedSha256" TEXT,
ADD COLUMN "encryptedSize" INTEGER,
ADD COLUMN "scanStatus" TEXT,
ADD COLUMN "scanCompletedAt" TIMESTAMP(3);

ALTER TABLE "TemporaryUpload"
ADD COLUMN "encryptionVersion" INTEGER,
ADD COLUMN "contentAlgorithm" TEXT,
ADD COLUMN "keyAlgorithm" TEXT,
ADD COLUMN "keyId" TEXT,
ADD COLUMN "keyVersion" INTEGER,
ADD COLUMN "encryptionIv" TEXT,
ADD COLUMN "wrappedKey" TEXT,
ADD COLUMN "originalSha256" TEXT,
ADD COLUMN "encryptedSha256" TEXT,
ADD COLUMN "encryptedSize" INTEGER,
ADD COLUMN "scanStatus" TEXT,
ADD COLUMN "scanCompletedAt" TIMESTAMP(3);

CREATE INDEX "Document_keyId_keyVersion_idx" ON "Document"("keyId", "keyVersion");
