ALTER TABLE "User"
ADD COLUMN "pinHash" TEXT,
ADD COLUMN "pinAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pinLockedUntil" TIMESTAMP(3);

ALTER TABLE "account_change_otps"
ADD COLUMN "newPinHash" TEXT;
