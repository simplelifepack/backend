ALTER TABLE "ReadinessPack"
ADD COLUMN "verificationSources" JSONB,
ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'needs_review';

UPDATE "ReadinessPack"
SET
  "verificationSources" = jsonb_build_array(jsonb_build_object(
    'title', "sourceTitle",
    'organization', "sourceName",
    'url', "sourceUrl",
    'type', 'government',
    'retrievedAt', COALESCE("lastCheckedAt", '2026-07-25T00:00:00.000Z'::timestamp)
  )),
  "lastVerifiedAt" = "lastCheckedAt",
  "verificationStatus" = 'verified'
WHERE "slug" = 'canada-visa'
  AND "sourceTitle" IS NOT NULL
  AND "sourceUrl" IS NOT NULL;

UPDATE "ReadinessPack"
SET "verificationStatus" = 'needs_review'
WHERE "createdBy" = 'ai';
