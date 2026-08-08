ALTER TYPE "TrustMemberStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "trust_members"
  ADD COLUMN IF NOT EXISTS "inviteTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "inviteExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invitePinHash" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pinAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pinLockedUntil" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "trust_members_inviteTokenHash_key" ON "trust_members"("inviteTokenHash");
CREATE INDEX IF NOT EXISTS "trust_members_email_status_idx" ON "trust_members"("email", "status");
CREATE INDEX IF NOT EXISTS "trust_members_inviteExpiresAt_idx" ON "trust_members"("inviteExpiresAt");

UPDATE "plans"
SET
  "trustCenterAccess" = true,
  "memberLimit" = CASE "code"
    WHEN 'FREEMIUM' THEN 0
    WHEN 'FAMILY' THEN 4
    WHEN 'PLUS' THEN 8
    ELSE "memberLimit"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('FREEMIUM', 'FAMILY', 'PLUS');
