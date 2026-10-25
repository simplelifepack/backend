import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewedPackageSources } from "./reviewedPackageSources";
const source = { url: "https://authority.example/checklist", title: "Checklist", organization: "Authority", checkedAt: "2026-10-04", sourceType: "government_checklist", validationStatus: "content_validated", applicability: { jurisdiction: "Example" } };
test("restores public references with their actual review date and applicability", () => {
  const [row] = reviewedPackageSources([{ id: "seed-example", slug: "example", sources: [source] }]);
  assert.equal(row.sources[0].retrievedAt, "2026-10-04");
  assert.equal(row.sources[0].type, "government");
  assert.deepEqual((row.sources[0] as Record<string, unknown>).applicability, source.applicability);
});
test("excludes unreviewed and obsolete references and rejects insecure URLs", () => {
  assert.deepEqual(reviewedPackageSources([{ id: "example", slug: "example", sources: [{ ...source, validationStatus: "pending" }, { ...source, currentnessStatus: "legacy_legal_references_do_not_import_as_current" }] }]), []);
  assert.throws(() => reviewedPackageSources([{ id: "example", slug: "example", sources: [{ ...source, url: "http://authority.example" }] }]));
});
