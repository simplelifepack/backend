CREATE TABLE "digilocker_consent_sessions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "referenceId" TEXT,
  "environment" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "statusMessage" TEXT,
  "consentUrl" TEXT,
  "redirectUrl" TEXT NOT NULL,
  "requestedDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "availableDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3),
  "authenticatedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "digilocker_consent_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "digilocker_consent_sessions_verificationId_key" ON "digilocker_consent_sessions"("verificationId");
CREATE INDEX "digilocker_consent_sessions_userId_status_idx" ON "digilocker_consent_sessions"("userId", "status");
CREATE INDEX "digilocker_consent_sessions_verificationId_idx" ON "digilocker_consent_sessions"("verificationId");

ALTER TABLE "digilocker_consent_sessions"
  ADD CONSTRAINT "digilocker_consent_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
