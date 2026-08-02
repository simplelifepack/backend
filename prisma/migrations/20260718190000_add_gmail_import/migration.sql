ALTER TABLE "Document"
ADD COLUMN "contentHash" TEXT,
ADD COLUMN "sourceProvider" TEXT,
ADD COLUMN "sourceMessageId" TEXT,
ADD COLUMN "sourceAttachmentId" TEXT;

ALTER TABLE "TemporaryUpload"
ADD COLUMN "contentHash" TEXT,
ADD COLUMN "sourceProvider" TEXT,
ADD COLUMN "sourceMessageId" TEXT,
ADD COLUMN "sourceAttachmentId" TEXT,
ADD COLUMN "externalCandidateId" TEXT;

CREATE TABLE "ExternalConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "providerEmail" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT NOT NULL,
  "grantedScopes" TEXT[],
  "status" TEXT NOT NULL DEFAULT 'connected',
  "lastScannedAt" TIMESTAMP(3),
  "scanStartedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalOAuthState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalDocumentCandidate" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "externalMessageId" TEXT NOT NULL,
  "externalAttachmentId" TEXT,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sender" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "suggestedCategory" TEXT NOT NULL,
  "suggestedDocumentType" TEXT NOT NULL,
  "relevanceReason" TEXT NOT NULL,
  "relevanceScore" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'candidate',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalDocumentCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Document_ownerProfileId_contentHash_key" ON "Document"("ownerProfileId", "contentHash");
CREATE INDEX "Document_sourceProvider_sourceMessageId_idx" ON "Document"("sourceProvider", "sourceMessageId");
CREATE UNIQUE INDEX "ExternalConnection_userId_provider_key" ON "ExternalConnection"("userId", "provider");
CREATE UNIQUE INDEX "ExternalConnection_provider_providerAccountId_key" ON "ExternalConnection"("provider", "providerAccountId");
CREATE INDEX "ExternalConnection_userId_status_idx" ON "ExternalConnection"("userId", "status");
CREATE UNIQUE INDEX "ExternalOAuthState_stateHash_key" ON "ExternalOAuthState"("stateHash");
CREATE INDEX "ExternalOAuthState_userId_provider_expiresAt_idx" ON "ExternalOAuthState"("userId", "provider", "expiresAt");
CREATE UNIQUE INDEX "ExternalDocumentCandidate_connectionId_sourceKey_key" ON "ExternalDocumentCandidate"("connectionId", "sourceKey");
CREATE INDEX "ExternalDocumentCandidate_userId_status_receivedAt_idx" ON "ExternalDocumentCandidate"("userId", "status", "receivedAt");

ALTER TABLE "ExternalConnection" ADD CONSTRAINT "ExternalConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalOAuthState" ADD CONSTRAINT "ExternalOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalDocumentCandidate" ADD CONSTRAINT "ExternalDocumentCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalDocumentCandidate" ADD CONSTRAINT "ExternalDocumentCandidate_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExternalConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
