-- Family/trust private content, retaining authorization state and verifiers.
ALTER TABLE "trust_members" ADD COLUMN "private_email" TEXT;
ALTER TABLE "trust_members" ADD COLUMN "private_name" TEXT;
ALTER TABLE "trust_members" ADD COLUMN "private_relation" TEXT;
ALTER TABLE "trust_members" ADD COLUMN "private_customRelation" TEXT;
ALTER TABLE "trust_members" ADD COLUMN "private_dateOfBirth" TEXT;
ALTER TABLE "trust_members" ADD COLUMN "private_bloodGroup" TEXT;
ALTER TABLE "trust_members" ADD CONSTRAINT "trust_members_private_v2" CHECK (
  ("private_email" IS NOT NULL AND "private_email" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("email" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_name" IS NOT NULL AND "private_name" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("name" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_relation" IS NOT NULL AND "private_relation" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("relation" = 'SPOUSE')
  AND ("private_customRelation" IS NOT NULL AND "private_customRelation" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("customRelation" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_dateOfBirth" IS NOT NULL AND "private_dateOfBirth" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("dateOfBirth" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_bloodGroup" IS NOT NULL AND "private_bloodGroup" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("bloodGroup" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
