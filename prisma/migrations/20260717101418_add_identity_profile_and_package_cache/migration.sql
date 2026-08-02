CREATE TABLE "UserIdentityProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "normalizedNameHash" TEXT NOT NULL,
  "dateOfBirth" TEXT NOT NULL,
  "dateOfBirthHash" TEXT NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "createdFromDocumentId" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserIdentityProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserIdentityProfile_userId_key" ON "UserIdentityProfile"("userId");
ALTER TABLE "UserIdentityProfile" ADD CONSTRAINT "UserIdentityProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReadinessPack"
ADD COLUMN "searchableKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "ReadinessPack_createdBy_idx" ON "ReadinessPack"("createdBy");
