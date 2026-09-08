CREATE TABLE "DocumentFile" (
  "id" TEXT NOT NULL, "documentId" TEXT NOT NULL, "pageIndex" INTEGER NOT NULL,
  "originalName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL, "storedName" TEXT NOT NULL, "encryptionVersion" INTEGER,
  "contentAlgorithm" TEXT, "keyAlgorithm" TEXT, "keyId" TEXT, "keyVersion" INTEGER,
  "encryptionIv" TEXT, "wrappedKey" TEXT, "encryptedSize" INTEGER, "ciphertextHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocumentFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DocumentFile_documentId_pageIndex_key" ON "DocumentFile"("documentId", "pageIndex");
CREATE INDEX "DocumentFile_documentId_idx" ON "DocumentFile"("documentId");
