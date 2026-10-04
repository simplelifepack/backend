import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { prisma } from "../../lib/prisma";
import { refreshPackageForUser } from "./packageRefresh.service";
import { planPackageRefresh } from "./packageRefreshPlan";
import type { RefreshChecklist, RefreshSource } from "../../ai/packageRefreshSchema";
import type { ReadinessPack, Requirement } from "@prisma/client";

const restores: Array<() => void> = [];
function replace<T extends object, K extends keyof T, F>(target: T, key: K, implementation: F): F {
  const original = target[key];
  target[key] = implementation as unknown as T[K];
  restores.push(() => { target[key] = original; });
  return implementation;
}
afterEach(() => { restores.splice(0).reverse().forEach(restore => restore()); mock.restoreAll(); });

const source: RefreshSource = { title: "Process documents", organization: "Authority", url: "https://authority.example/process", type: "authority", scope: "national", relevance: "Process-specific documents", validationStatus: "validated", verificationMethod: "web_search_and_page_evidence", checkedAt: "2026-10-04", retrievedAt: "2026-10-04", currentnessStatus: "checked" };
const checklist: RefreshChecklist = { exactProcess: true, completeChecklist: true, confidence: "high", disclaimer: "Check your eligibility.", applicability: { jurisdiction: null, destination: null, purpose: null, passportCountries: [] }, sources: [{ url: source.url, relevance: source.relevance, evidence: "Provide an identity document for your application." }], requirements: [{ existingId: "req-1", title: "Identity", description: "Provide identification", documentType: "identity_proof", owner: "self", required: true, group: "Identity", acceptedDocumentTypes: ["identity_proof"], alternativeLabels: [], condition: null, maxAgeDays: null, sourceUrl: source.url, evidence: "Provide an identity document for your application." }] };
const row = { id: "req-1", packId: "pack-1", title: "Identity", description: "Provide identification", documentType: "identity_proof", owner: "self", required: true, group: "Identity", acceptedDocumentTypes: ["identity_proof"], alternativeLabels: [], metadata: { sourceUrl: source.url, sourceEvidence: checklist.requirements[0]!.evidence }, sortOrder: 0 } as Requirement;
const base = { id: "pack-1", slug: "test-process", title: "Test process", createdBy: "seed", updatedAt: new Date(), requirements: [row], version: 1 } as ReadinessPack & { requirements: Requirement[] };

function setup(pack = base, lockCount = 1) {
  replace(prisma.user, "findUnique", async () => ({ aiProcessingEnabled: true }));
  const lookup = replace(prisma.readinessPack, "findUnique", mock.fn(async (_query: { where: unknown }) => ({ ...pack, lastCheckedAt: new Date() })));
  const researchCall = mock.fn(async () => ({ checklist, sources: [source] }));
  replace(prisma.readinessPack, "count", async () => 1);
  replace(prisma.requirementAssignment, "findMany", async () => []);
  const writes: Array<{ operation: string; data: unknown }> = [];
  replace(prisma, "$transaction", async (action: (tx: unknown) => Promise<unknown>) => action({
    readinessPack: { updateMany: async (input: { data: unknown }) => { writes.push({ operation: "pack", data: input.data }); return { count: lockCount }; } },
    requirement: { update: async (input: unknown) => { writes.push({ operation: "update", data: input }); }, create: async (input: unknown) => { writes.push({ operation: "create", data: input }); } },
  }));
  return { lookup, researchCall, writes };
}
test("refresh persists changed fields and returns the latest DB detail", async () => {
  const { writes, lookup, researchCall } = setup();
  const result = await refreshPackageForUser("user-1", "test-process", researchCall);
  assert.equal(result.changed, true);
  assert.equal(result.package.slug, "test-process");
  assert.ok(result.package.source.lastCheckedAt);
  assert.deepEqual(lookup.mock.calls[0]!.arguments[0].where, { slug: "test-process" });
  assert.deepEqual((writes[0]!.data as { version: unknown }).version, { increment: 1 });
});
test("no-change refresh only updates check dates, never requirements or version", async () => {
  const data = planPackageRefresh(base, checklist, [source]).data;
  const { writes, researchCall } = setup({ ...base, ...data } as typeof base);
  const result = await refreshPackageForUser("user-1", "test-process", researchCall);
  assert.equal(result.changed, false);
  assert.match(result.message, /no changes/);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]!.data as object).sort(), ["lastCheckedAt", "lastVerifiedAt"]);
});
test("concurrent edits abort before any requirement write", async () => {
  const { writes, researchCall } = setup(base, 0);
  await assert.rejects(refreshPackageForUser("user-1", "test-process", researchCall), /changed while/);
  assert.equal(writes.length, 1);
});
test("another user's custom package cannot be researched or updated", async () => {
  const { researchCall, writes } = setup({ ...base, createdBy: "owner-1" });
  await assert.rejects(refreshPackageForUser("user-2", "test-process", researchCall), /not found/);
  assert.equal(researchCall.mock.callCount(), 0);
  assert.equal(writes.length, 0);
});
test("research failures never stamp a successful last-checked date", async () => {
  const { writes } = setup();
  await assert.rejects(refreshPackageForUser("user-1", "test-process", async () => { throw new Error("Invalid evidence"); }), /Invalid evidence/);
  assert.equal(writes.length, 0);
});
