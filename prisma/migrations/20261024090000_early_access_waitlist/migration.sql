CREATE TYPE "WaitlistStatus" AS ENUM ('registered', 'unsubscribed');
CREATE TYPE "WaitlistDeliveryStatus" AS ENUM ('pending', 'sending', 'sent', 'failed', 'unknown');
CREATE TABLE "WaitlistRegistration" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "private_email" TEXT NOT NULL CHECK ("private_email" LIKE 'enc:v2:%'),
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "WaitlistStatus" NOT NULL DEFAULT 'registered',
  "unsubscribedAt" TIMESTAMP(3),
  "confirmationStatus" "WaitlistDeliveryStatus" NOT NULL DEFAULT 'pending',
  "confirmationAttempts" INTEGER NOT NULL DEFAULT 0,
  "confirmationSentAt" TIMESTAMP(3),
  "confirmationMessageId" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaitlistRegistration_email_normalized" CHECK ("email" = lower(btrim("email")))
);
CREATE INDEX "WaitlistRegistration_confirmationStatus_nextAttemptAt_idx" ON "WaitlistRegistration" ("confirmationStatus", "nextAttemptAt");
CREATE TABLE "WaitlistRateLimit" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "WaitlistRateLimit_expiresAt_idx" ON "WaitlistRateLimit" ("expiresAt");
CREATE TABLE "WaitlistProof" ("id" TEXT PRIMARY KEY, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "WaitlistProof_expiresAt_idx" ON "WaitlistProof" ("expiresAt");
