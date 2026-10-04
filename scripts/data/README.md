# Reviewed Package Sources

`reviewed-package-sources.json` is the reviewed research artifact, not runtime configuration. Only `scripts/seed-reviewed-package-sources.mjs` reads it. Normal API requests read Prisma records.

Run from the backend root with the intended `DATABASE_URL` configured:

```sh
node scripts/seed-reviewed-package-sources.mjs
node scripts/seed-reviewed-package-sources.mjs --apply --report source-seed-result.json
node scripts/seed-reviewed-package-sources.mjs
node --test scripts/seed-reviewed-package-sources.test.mjs
```

Dry run is the default. Match by slug and confirm the reviewed reference ID and system ownership. This importer never creates or deletes packages, requirements, documents or assignments. It replaces source arrays atomically and skips unchanged rows on reruns.

Reviewed metadata is preserved in source JSON, with `type` and `retrievedAt` aliases for the existing API/UI. Pending candidates, incomplete interactive checks and explicitly rejected stale policies are excluded from usable sources. They and review gaps remain in the existing package JSON under `searchMetadata.sourceReview`, a namespace ignored by the existing search parser. Search phrases, categories and applicability keys remain unchanged. No source review certifies the package's full requirement list, so package verification remains `needs_review`.

The transaction verifies unchanged package content, requirements, custom packs, documents and assignments, and aborts on identity/ownership/concurrency conflicts. No data migration is used. Existing browser catalogue caches may retain older responses until the existing refresh/cache-clear flow is used; seeding does not reset user state or modify cache behavior.
