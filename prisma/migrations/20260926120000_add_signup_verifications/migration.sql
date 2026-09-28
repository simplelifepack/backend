CREATE TABLE "signup_verifications" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signup_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signup_verifications_email_key" ON "signup_verifications"("email");
CREATE INDEX "signup_verifications_expiresAt_idx" ON "signup_verifications"("expiresAt");
