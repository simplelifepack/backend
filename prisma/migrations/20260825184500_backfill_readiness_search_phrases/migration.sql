UPDATE "ReadinessPack"
SET "searchMetadata" = jsonb_set(
  COALESCE("searchMetadata", '{}'::jsonb),
  '{searchPhrases}',
  COALESCE("searchMetadata"->'searchPhrases', '[]'::jsonb) || jsonb_build_array("description")
);

UPDATE "ReadinessPack"
SET "searchMetadata" = jsonb_set(
  "searchMetadata",
  '{jurisdiction}',
  to_jsonb(initcap(replace(substring("slug" from '-document-([a-z-]+)$'), '-', ' ')))
)
WHERE "slug" ~ '-document-[a-z-]+$'
  AND substring("slug" from '-document-([a-z-]+)$') IS NOT NULL;
