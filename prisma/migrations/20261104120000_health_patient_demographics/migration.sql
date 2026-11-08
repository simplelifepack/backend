-- Add optional patient demographics without altering existing profile values.
ALTER TABLE "health_members"
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "age" INTEGER,
  ADD COLUMN "ageRecordedAt" TIMESTAMP(3),
  ADD COLUMN "private_gender" TEXT,
  ADD COLUMN "private_age" TEXT,
  ADD COLUMN "private_ageRecordedAt" TEXT;
-- Native age/date columns stay null; all values use the existing encrypted codec.
ALTER TABLE "health_members" ADD CONSTRAINT "health_member_demographics_private" CHECK (
  "age" IS NULL AND "ageRecordedAt" IS NULL
  AND ("gender" IS NULL OR ("gender" ~ '^hmac:v2:[0-9a-f]{64}$' AND "private_gender" IS NOT NULL))
  AND ("private_gender" IS NULL OR "private_gender" ~ '^enc:v2:')
  AND ("private_age" IS NULL OR "private_age" ~ '^enc:v2:')
  AND ("private_ageRecordedAt" IS NULL OR "private_ageRecordedAt" ~ '^enc:v2:')
);
