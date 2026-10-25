import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { researchPackageRefresh } from "./researchPackageRefresh";
const originalKey = process.env.OPENAI_API_KEY;
afterEach(() => { mock.restoreAll(); if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
const result = {
  confidence: "medium", disclaimer: "Sources are provided for user and admin review.",
  applicability: { jurisdiction: null, destination: null, purpose: null, passportCountries: [] },
  sources: [{ title: "Official application guidance", organization: "Authority", url: "https://authority.example/blocked.pdf", type: "official", scope: "national", relevance: "Application documents" }],
  requirements: [{ existingId: "req-1", title: "Identity", description: "Identity document", documentType: "identity_proof", owner: "self", required: true, group: "Identity", acceptedDocumentTypes: ["identity_proof"], alternativeLabels: [], condition: null, maxAgeDays: null, sourceUrl: "https://authority.example/blocked.pdf" }],
};
const dependencies = { assertAIProcessingEnabled: async () => undefined, consumeAIAction: async () => undefined };
test("AI returns checklist and reference links without any backend source download or verification", async () => {
  process.env.OPENAI_API_KEY = "synthetic-test-key";
  const calls: string[] = [];
  mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    calls.push(url);
    assert.equal(url, "https://api.openai.com/v1/responses");
    const request = JSON.parse(String(options.body));
    assert(request.tools.some((tool: { type: string }) => tool.type === "web_search"));
    assert(!String(options.body).includes("PRIVATE-DOCUMENT"));
    return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(result) }] }] }), { status: 200 });
  });
  const researched = await researchPackageRefresh("synthetic", { title: "Application", category: "Identity", searchMetadata: {}, verificationSources: [], requirements: [] }, AbortSignal.timeout(5000), dependencies);
  assert.equal(calls.length, 1);
  assert.equal(researched.checklist.requirements[0].title, "Identity");
  assert.equal(researched.sources[0].url, result.sources[0].url);
  assert.equal(researched.sources[0].validationStatus, "needs_review");
  assert.equal(researched.sources[0].currentnessStatus, "not_verified");
});
test("reference links are deduplicated without fetching or verifying their targets", async () => {
  process.env.OPENAI_API_KEY = "synthetic-test-key";
  const payload = structuredClone(result); payload.sources.push(payload.sources[0]);
  payload.requirements[0].sourceUrl = "https://authority.example/another-reference";
  let calls = 0;
  mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(url, "https://api.openai.com/v1/responses"); calls++;
    return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(payload) }] }] }), { status: 200 });
  });
  const researched = await researchPackageRefresh("synthetic", { title: "Application", category: "Identity", searchMetadata: {}, verificationSources: [], requirements: [] }, AbortSignal.timeout(5000), dependencies);
  assert.equal(calls, 1); assert.equal(researched.sources.length, 1);
});
test("malformed AI output remains a genuine request failure", async () => {
  process.env.OPENAI_API_KEY = "synthetic-test-key";
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ sources: [] }) }] }] }), { status: 200 }));
  await assert.rejects(researchPackageRefresh("synthetic", { title: "Application", category: "Identity", searchMetadata: {}, verificationSources: [], requirements: [] }, AbortSignal.timeout(5000), dependencies), /invalid package result/);
});
