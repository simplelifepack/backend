DROP INDEX IF EXISTS "trust_members_ownerUserId_email_status_key";

CREATE UNIQUE INDEX IF NOT EXISTS "trust_members_owner_email_open_unique"
ON "trust_members"("ownerUserId", "email")
WHERE "status" IN ('INVITED', 'ACTIVE');
