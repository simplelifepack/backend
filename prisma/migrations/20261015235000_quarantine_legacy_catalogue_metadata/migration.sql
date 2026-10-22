-- Public seed aliases/search metadata may contain previously appended user input.
-- Preserve their full snapshot in ciphertext during backfill; never expose it
-- through catalogue/admin APIs. New operator-authored rows have clean provenance.
ALTER TABLE "ReadinessPack" ADD COLUMN "legacyPrivateMetadata" TEXT;
ALTER TABLE "ReadinessPack" ADD COLUMN "cataloguePrivacyVersion" INTEGER;
ALTER TABLE "ReadinessPack" ALTER COLUMN "cataloguePrivacyVersion" SET DEFAULT 2;
ALTER TABLE "ReadinessPack" ADD CONSTRAINT "catalogue_provenance_v2" CHECK (
  "cataloguePrivacyVersion" IS NOT NULL AND "cataloguePrivacyVersion" = 2
  AND ("legacyPrivateMetadata" IS NULL OR "legacyPrivateMetadata" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
) NOT VALID;
