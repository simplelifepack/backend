ALTER TABLE "Document" ADD COLUMN "normalizedType" TEXT;

CREATE TABLE "ReadinessPack" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "aliases" TEXT[],
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadinessPack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "group" TEXT NOT NULL,
    "acceptedDocumentTypes" TEXT[],
    "alternativeLabels" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReadinessPack_slug_key" ON "ReadinessPack"("slug");
CREATE INDEX "ReadinessPack_category_idx" ON "ReadinessPack"("category");
CREATE INDEX "Requirement_packId_idx" ON "Requirement"("packId");
CREATE INDEX "Document_normalizedType_idx" ON "Document"("normalizedType");
CREATE INDEX "Document_documentType_idx" ON "Document"("documentType");

ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_packId_fkey" FOREIGN KEY ("packId") REFERENCES "ReadinessPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
