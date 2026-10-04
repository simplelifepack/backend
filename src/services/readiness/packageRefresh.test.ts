import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReadinessPack, Requirement } from "@prisma/client";
import { jsonObject, planPackageRefresh } from "./packageRefreshPlan";
import { packageRefreshResearchContext, validateRefreshEvidence } from "../../ai/researchPackageRefresh";
import { packageSourceText, publicSourceAddress, readPackageSourcePage } from "../../ai/packageSourcePage";
import type { RefreshChecklist, RefreshSource } from "../../ai/packageRefreshSchema";

const url = "https://authority.example/checklist";
const evidence = "Applicants must provide an identity document.";
const source: RefreshSource = { url, title: "Official checklist", organization: "Authority", type: "authority", scope: "national", relevance: "Exact application checklist", validationStatus: "validated", verificationMethod: "web_search_and_page_evidence", checkedAt: "2026-10-04", retrievedAt: "2026-10-04", currentnessStatus: "checked" };
const checklist: RefreshChecklist = {
  exactProcess: true, completeChecklist: true, confidence: "high", disclaimer: "Eligibility is not guaranteed.",
  applicability: { jurisdiction: null, destination: null, purpose: null, passportCountries: [] },
  sources: [{ url, relevance: source.relevance, evidence }],
  requirements: [{ existingId: "req-1", title: "Identity document", description: "Provide identification.", documentType: "identity_proof", owner: "self", required: true, group: "Identity", acceptedDocumentTypes: ["identity_proof"], alternativeLabels: [], condition: null, maxAgeDays: null, sourceUrl: url, evidence }],
};
const requirement = { id: "req-1", packId: "pack-1", title: "Identity document", description: "Provide identification.", documentType: "identity_proof", owner: "self", required: true, group: "Identity", acceptedDocumentTypes: ["identity_proof"], alternativeLabels: [], metadata: { sourceUrl: url, sourceEvidence: evidence }, sortOrder: 0 } as Requirement;
const pack = {
  id: "pack-1", slug: "test-process", title: "Test process", category: "Test", aliases: [], keywords: [], description: "Test",
  sourceType: "curated", sourceName: source.organization, sourceTitle: source.title, sourceUrl: url,
  verificationStatus: "verified", verificationSources: [source], createdBy: "seed", version: 1,
  searchMetadata: { uiIcon: "File", referenceId: "stable-reference", jurisdiction: "India", confidence: checklist.confidence, disclaimer: checklist.disclaimer },
  requirements: [requirement],
} as unknown as ReadinessPack & { requirements: Requirement[] };

test("date-only checks do not replace requirements or increment dataset versions", () => {
  const plan = planPackageRefresh(pack, checklist, [{ ...source, checkedAt: "2026-10-05", retrievedAt: "2026-10-05" }]);
  assert.equal(plan.changed, false);
  assert.equal(plan.requirements[0]!.changed, false);
  assert.equal(plan.requirements[0]!.id, requirement.id);
  assert.equal(plan.data.searchMetadata.referenceId, "stable-reference");
});
test("research applicability comes from DB metadata without an implicit country", () => {
  assert.equal(packageRefreshResearchContext({ ...pack, searchMetadata: {} }).jurisdiction, undefined);
  const context = packageRefreshResearchContext({ ...pack, searchMetadata: { jurisdiction: "Stored jurisdiction", destination: "Stored destination", passportCountries: ["XX"] } });
  assert.equal(context.jurisdiction, "Stored jurisdiction");
  assert.equal(context.destination, "Stored destination");
  assert.deepEqual(context.passportCountries, ["XX"]);
});
test("changed conditions and applicability are persisted while icon/reference metadata survive", () => {
  const update = structuredClone(checklist);
  update.requirements[0]!.condition = "For first-time applicants";
  update.requirements[0]!.required = false;
  update.applicability.destination = "Destination";
  const plan = planPackageRefresh(pack, update, [source]);
  assert.equal(plan.changed, true);
  assert.equal(plan.requirements[0]!.id, requirement.id);
  assert.equal(plan.requirements[0]!.data.metadata.condition, "For first-time applicants");
  assert.equal(plan.requirements[0]!.data.required, false);
  assert.equal(plan.data.searchMetadata.destination, "Destination");
  assert.equal(plan.data.searchMetadata.uiIcon, "File");
});
test("refresh keeps the existing source-scope field consistent with newly verified scope", () => {
  const plan = planPackageRefresh({ ...pack, verificationSources: [{ ...source, sourceScope: "national", reviewNote: "Existing audit note" }] }, checklist, [{ ...source, scope: "provider_specific" }]);
  assert.equal(plan.data.verificationSources[0]!.scope, "provider_specific");
  assert.equal(plan.data.verificationSources[0]!.sourceScope, "provider_specific");
  assert.equal(jsonObject(plan.data.verificationSources[0]).reviewNote, "Existing audit note");
});
test("retired requirements keep their rows/assignment IDs and reactivation uses the original ID", () => {
  const extra = { ...requirement, id: "req-old", title: "Old requirement", documentType: "other" };
  const plan = planPackageRefresh({ ...pack, requirements: [requirement, extra] }, checklist, [source]);
  assert.equal(plan.retired[0]!.id, "req-old");
  const restored = planPackageRefresh({ ...pack, requirements: [{ ...requirement, metadata: { ...requirement.metadata as object, refreshRetired: true } }] }, checklist, [source]);
  assert.equal(restored.requirements[0]!.id, "req-1");
  assert.equal(restored.requirements[0]!.data.metadata.refreshRetired, undefined);
});
test("new slots do not reuse another owner's ID, and duplicate slots are rejected", () => {
  const wrongOwner = structuredClone(checklist); wrongOwner.requirements[0]!.owner = "seller";
  assert.throws(() => planPackageRefresh(pack, wrongOwner, [source]), /identity/);
  const duplicate = structuredClone(checklist); duplicate.requirements.push(duplicate.requirements[0]!);
  assert.throws(() => planPackageRefresh(pack, duplicate, [source]), /duplicate/);
});
test("failed/incomplete research or unsupported requirement evidence cannot update a checklist", () => {
  const pages = new Map([[url, evidence]]);
  assert.doesNotThrow(() => validateRefreshEvidence(checklist, pages));
  assert.throws(() => validateRefreshEvidence({ ...checklist, completeChecklist: false }, pages), /not changed/);
  assert.throws(() => validateRefreshEvidence(checklist, new Map()), /not changed/);
  const unrelated = structuredClone(checklist); unrelated.requirements[0]!.sourceUrl = "https://other.example/";
  assert.throws(() => validateRefreshEvidence(unrelated, pages), /validated source/);
});
test("source retrieval rejects private IPs and non-HTTPS URLs before connection", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.2", "192.168.1.2", "169.254.169.254", "172.16.1.1", "100.64.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(publicSourceAddress(ip), false);
  assert.equal(publicSourceAddress("8.8.8.8"), true);
  await assert.rejects(readPackageSourcePage("http://localhost/", new AbortController().signal), /Unsafe/);
});
test("HTML evidence is decoded text with separate blocks, not markup entities or scripts", () => {
  assert.equal(packageSourceText("<script>untrusted script text</script><p>ID &amp; address</p><p>PAN&#39;s copy&nbsp;required</p>"), "ID & address PAN's copy required");
});
test("short checklist labels are valid when their source also proves process context", () => {
  const update = structuredClone(checklist); update.requirements[0]!.evidence = "Identity document";
  assert.doesNotThrow(() => validateRefreshEvidence(update, new Map([[url, `${evidence} Identity document`]])));
  update.requirements[0]!.evidence = "Unlisted document";
  assert.throws(() => validateRefreshEvidence(update, new Map([[url, evidence]])), /not changed/);
});
