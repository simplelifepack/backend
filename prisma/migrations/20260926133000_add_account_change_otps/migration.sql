CREATE TABLE "account_change_otps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "newEmail" TEXT,
    "newPasswordHash" TEXT,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_change_otps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_change_otps_userId_purpose_key" ON "account_change_otps"("userId", "purpose");
CREATE INDEX "account_change_otps_expiresAt_idx" ON "account_change_otps"("expiresAt");

ALTER TABLE "account_change_otps" ADD CONSTRAINT "account_change_otps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
