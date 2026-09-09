import assert from "node:assert/strict";
import { OpenAIProvider, validateIntentAnalysis } from "./openai";

for (const malformed of [null, {}, { packageName: "x", category: "x", description: "x", requiredDocuments: [] }]) {
  assert.throws(() => validateIntentAnalysis(malformed));
}

const basePackage = {
  packageName: "Study Abroad",
  category: "Education",
  description: "Documents for admission readiness.",
  searchMetadata: { intent: "study", subject: "admission", purpose: "student visa", jurisdiction: "US", destination: "US", searchPhrases: [] },
  sourceTitle: "Admissions",
  sourceUrl: "https://www.harvard.edu/admissions/",
  sourceOrganization: "Harvard University",
  lastChecked: "2026-09-09T00:00:00.000Z",
  verificationSources: [{
    title: "Admissions",
    organization: "Harvard University",
    url: "https://www.harvard.edu/admissions/",
    type: "university",
    retrievedAt: "2026-09-09T00:00:00.000Z",
  }],
  lastVerifiedAt: "2026-09-09T00:00:00.000Z",
  verificationStatus: "verified",
  requiredDocuments: [{
    id: "admission_letter",
    category: "Education",
    documentType: "admission letter",
    owner: "self",
    name: "Admission letter",
    title: "Admission letter",
    required: true,
    whyNeeded: "Confirms admission.",
    sourceName: "Harvard University",
    sourceUrl: "https://www.harvard.edu/admissions/",
    sourceAuthorityTier: "official",
    lastVerifiedAt: "2026-09-09T00:00:00.000Z",
  }],
};

assert.equal(validateIntentAnalysis(basePackage).requiredDocuments.length, 1);
assert.equal(validateIntentAnalysis({
  ...basePackage,
  requiredDocuments: [{
    ...basePackage.requiredDocuments[0],
    sourceName: "State Bank of India",
    sourceUrl: "https://sbi.co.in/web/personal-banking/accounts",
    sourceAuthorityTier: "commercial",
  }],
}).requiredDocuments.length, 1);
assert.equal(validateIntentAnalysis({
  ...basePackage,
  sourceTitle: "Graduate Admissions",
  sourceUrl: "https://tickle.utk.edu/future-students/graduate-students/",
  sourceOrganization: "University of Tennessee, Knoxville",
  verificationSources: [{
    title: "Graduate Admissions",
    organization: "University of Tennessee, Knoxville",
    url: "https://tickle.utk.edu/future-students/graduate-students/",
    type: "official",
    retrievedAt: "2026-09-09T00:00:00.000Z",
  }],
  requiredDocuments: [{
    ...basePackage.requiredDocuments[0],
    sourceName: "University of Tennessee, Knoxville",
    sourceUrl: "https://tickle.utk.edu/future-students/graduate-students/",
    sourceAuthorityTier: "official",
  }],
}).sourceUrl, "https://tickle.utk.edu/future-students/graduate-students/");
assert.throws(() => validateIntentAnalysis({
  ...basePackage,
  requiredDocuments: [{
    ...basePackage.requiredDocuments[0],
    sourceName: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Visa_policy",
    sourceAuthorityTier: "official",
  }],
}), /contains no required documents/);

const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
const originalTimeoutEnv = process.env.OPENAI_REQUEST_TIMEOUT_MS;
let capturedTimeoutMs: number | undefined;

void (async () => {
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify(basePackage) }] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    AbortSignal.timeout = ((milliseconds: number) => {
      capturedTimeoutMs = milliseconds;
      return originalTimeout.call(AbortSignal, 1_000);
    }) as typeof AbortSignal.timeout;
    process.env.OPENAI_REQUEST_TIMEOUT_MS = "60000";
    await new OpenAIProvider("test").analyzeIntent("test");
    assert.equal(capturedTimeoutMs, 60_000);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    if (originalTimeoutEnv === undefined) delete process.env.OPENAI_REQUEST_TIMEOUT_MS;
    else process.env.OPENAI_REQUEST_TIMEOUT_MS = originalTimeoutEnv;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
