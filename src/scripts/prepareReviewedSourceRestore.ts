import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { reviewedPackageSources } from "./reviewedPackageSources";

// Generates a reviewable public-data-only statement; never connects to a database.
async function run() {
  const output = process.argv[process.argv.indexOf("--output") + 1];
  assert(process.argv.includes("--output") && output, "An explicit --output path is required.");
  const data = JSON.parse(await fs.readFile(path.resolve(__dirname, "../../scripts/data/reviewed-package-sources.json"), "utf8"));
  const rows = reviewedPackageSources(data.rows);
  assert.equal(rows.length, 63);
  assert.equal(rows.reduce((n, row) => n + row.sources.length, 0), 121);
  const payload = JSON.stringify(rows).replace(/'/g, "''");
  const sql = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $restore$
DECLARE eligible integer; changed integer; requirement_count bigint; assignment_count bigint; private_count bigint;
BEGIN
  SELECT count(*) INTO requirement_count FROM "Requirement";
  SELECT count(*) INTO assignment_count FROM "requirement_assignments";
  SELECT count(*) INTO private_count FROM "ReadinessPack" WHERE "createdBy" <> 'seed';
  SELECT count(*) INTO eligible FROM "ReadinessPack" p JOIN jsonb_to_recordset('${payload}'::jsonb) AS r(id text, slug text, sources jsonb) ON p.id = r.id AND p.slug = r.slug
  WHERE p."createdBy" = 'seed' AND p."deletedAt" IS NULL AND p."sourceName" IS NULL AND p."sourceTitle" IS NULL AND p."sourceUrl" IS NULL AND p."verificationSources" IS NULL AND p."lastCheckedAt" IS NULL AND p."lastVerifiedAt" IS NULL AND p."verificationStatus" = 'needs_review';
  IF eligible <> 63 THEN RAISE EXCEPTION 'Expected 63 unchanged, empty reviewed source records; found %', eligible; END IF;
  UPDATE "ReadinessPack" p SET "sourceName" = r.sources->0->>'organization', "sourceTitle" = r.sources->0->>'title', "sourceUrl" = r.sources->0->>'url', "verificationSources" = r.sources, "lastCheckedAt" = (r.sources->0->>'checkedAt')::timestamp, "lastVerifiedAt" = NULL, "verificationStatus" = 'needs_review', "updatedAt" = CURRENT_TIMESTAMP
  FROM jsonb_to_recordset('${payload}'::jsonb) AS r(id text, slug text, sources jsonb)
  WHERE p.id = r.id AND p.slug = r.slug AND p."createdBy" = 'seed' AND p."deletedAt" IS NULL AND p."sourceName" IS NULL AND p."sourceTitle" IS NULL AND p."sourceUrl" IS NULL AND p."verificationSources" IS NULL AND p."lastCheckedAt" IS NULL AND p."lastVerifiedAt" IS NULL AND p."verificationStatus" = 'needs_review';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 63 THEN RAISE EXCEPTION 'Source record changed concurrently'; END IF;
  IF requirement_count <> (SELECT count(*) FROM "Requirement") OR assignment_count <> (SELECT count(*) FROM "requirement_assignments") OR private_count <> (SELECT count(*) FROM "ReadinessPack" WHERE "createdBy" <> 'seed') THEN RAISE EXCEPTION 'Catalogue relationships changed'; END IF;
END $restore$;
COMMIT;
SELECT count(*)::int AS packages_with_sources, sum(jsonb_array_length("verificationSources"))::int AS source_references FROM "ReadinessPack" WHERE "createdBy" = 'seed' AND "deletedAt" IS NULL AND "verificationSources" IS NOT NULL;\n`;
  await fs.writeFile(output, sql, { mode: 0o600 });
  console.log(JSON.stringify({ output, packages: rows.length, sources: 121 }));
}
run().catch(() => { console.error("Public source restore SQL preparation failed."); process.exitCode = 1; });
