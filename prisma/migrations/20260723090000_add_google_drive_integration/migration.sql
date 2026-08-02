ALTER TABLE "ExternalConnection"
ADD COLUMN "lastSuccessfulSync" TIMESTAMP(3),
ADD COLUMN "scanPhase" TEXT,
ADD COLUMN "scanProcessed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "scanTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "indexedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastScanError" TEXT;

ALTER TABLE "Document"
ADD COLUMN "driveFileId" TEXT,
ADD COLUMN "sourceModifiedTime" TIMESTAMP(3),
ADD COLUMN "sourceChecksum" TEXT,
ADD COLUMN "lastAnalyzed" TIMESTAMP(3);

CREATE UNIQUE INDEX "Document_ownerProfileId_driveFileId_key"
ON "Document"("ownerProfileId", "driveFileId");

CREATE INDEX "Document_ownerProfileId_sourceChecksum_idx"
ON "Document"("ownerProfileId", "sourceChecksum");
