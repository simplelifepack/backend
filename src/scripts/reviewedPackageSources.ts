import assert from "node:assert/strict";

type ReviewedRow = { id: string; slug: string; sources: Array<Record<string, unknown>> };
const accepted = new Set(["content_validated", "content_validated_in_original_review"]);
const excluded = new Set(["legacy_legal_references_do_not_import_as_current", "policy_confirmation_required_old_examples"]);

/** Only reviewed public references; never decrypt or republish the legacy archive. */
export function reviewedPackageSources(rows: ReviewedRow[]) {
  return rows.flatMap(row => {
    const sources = row.sources.filter(source => accepted.has(String(source.validationStatus)) && !excluded.has(String(source.currentnessStatus))).map(source => {
      assert.equal(new URL(String(source.url)).protocol, "https:");
      assert(source.title && source.organization && source.checkedAt);
      return { ...source, organization: String(source.organization), title: String(source.title), url: String(source.url), checkedAt: String(source.checkedAt), type: String(source.sourceType).startsWith("government_") ? "government" : "official", retrievedAt: String(source.checkedAt) };
    });
    return sources.length ? [{ id: row.id, slug: row.slug, sources }] : [];
  });
}
