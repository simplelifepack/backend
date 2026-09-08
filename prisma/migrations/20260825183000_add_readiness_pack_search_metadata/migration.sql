ALTER TABLE "ReadinessPack" ADD COLUMN "searchMetadata" JSONB;

UPDATE "ReadinessPack"
SET "searchMetadata" = jsonb_build_object(
  'intent', regexp_replace(lower("category"), '[^a-z0-9]+', '-', 'g'),
  'subject', lower("title"),
  'searchPhrases', to_jsonb("aliases")
)
WHERE "searchMetadata" IS NULL;
