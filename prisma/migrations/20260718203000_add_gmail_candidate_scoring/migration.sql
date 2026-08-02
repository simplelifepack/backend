ALTER TABLE "ExternalDocumentCandidate"
ADD COLUMN "legitimacyReason" TEXT NOT NULL DEFAULT 'Needs review',
ADD COLUMN "legitimacyScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "matchedSignals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "rejectedSignals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "ignoredReason" TEXT,
ADD COLUMN "externalPartId" TEXT;
