CREATE TABLE "TemporaryUpload" (
    "id" TEXT NOT NULL,
    "ownerProfileId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "detectedMimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "TemporaryUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TemporaryUpload_ownerProfileId_status_expiresAt_idx" ON "TemporaryUpload"("ownerProfileId", "status", "expiresAt");
CREATE INDEX "TemporaryUpload_expiresAt_idx" ON "TemporaryUpload"("expiresAt");
