-- Hand-cleaned: `prisma migrate dev --create-only` generated DROP INDEX
-- statements for ~16 unrelated indexes due to pre-existing drift between
-- schema.prisma's index annotations and the already-applied migration
-- history (same issue noted in prior migrations this session). Keeping only
-- the actual change.

-- CreateTable
CREATE TABLE "PackRevision" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "editedBy" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackRevision_packId_createdAt_idx" ON "PackRevision"("packId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PackRevision_packId_version_key" ON "PackRevision"("packId", "version");

-- AddForeignKey
ALTER TABLE "PackRevision" ADD CONSTRAINT "PackRevision_packId_fkey" FOREIGN KEY ("packId") REFERENCES "ReadinessPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
