import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeImportedDocument } from "./documentImportAnalysis";
const file = { path: "/synthetic/original.pdf", originalName: "private-original.pdf", mimeType: "application/pdf", size: 15 };
test("disabled AI offers manual entry without invoking any extraction", async () => {
  let calls = 0;
  const result = await analyzeImportedDocument("synthetic-owner", file, { assertAIProcessingEnabled: async () => { throw Object.assign(new Error("disabled"), { code: "AI_PROCESSING_DISABLED" }); }, analyzeDocument: async () => { calls++; throw new Error("must not call"); } });
  assert.equal(calls, 0); assert.equal(result.analysisSource, "manual"); assert.equal(result.warnings[0].code, "AI_PROCESSING_DISABLED"); assert.equal(result.extractedText, ""); assert.equal(result.documentType, "unknown");
});
test("failed AI offers retry/manual entry without leaking provider text or using a fallback", async () => {
  let calls = 0;
  const result = await analyzeImportedDocument("synthetic-owner", file, { assertAIProcessingEnabled: async () => undefined, analyzeDocument: async () => { calls++; throw new Error("PRIVATE_PROVIDER_CONTENT"); } });
  assert.equal(calls, 1); assert.equal(result.analysisSource, "manual"); assert.equal(result.warnings[0].code, "AI_ANALYSIS_UNAVAILABLE"); assert(!JSON.stringify(result).includes("PRIVATE_PROVIDER_CONTENT")); assert.equal(result.extractedText, "");
});
test("successful import uses AI fields/text and original-file input", async () => {
  const result = await analyzeImportedDocument("synthetic-owner", file, { assertAIProcessingEnabled: async () => undefined, analyzeDocument: async files => { assert.deepEqual(files, [file]); return { category: "Finance", documentType: "Bank statement", uniqueNumber: "SYNTHETIC-ACCOUNT", nameOnDocument: "Example", expiryDate: null, fields: { bank: "Example" }, extractedText: "Synthetic original text" }; } });
  assert.equal(result.analysisSource, "ai"); assert.equal(result.extractedText, "Synthetic original text"); assert.equal(result.extractedFields.bank, "Example"); assert.equal(result.validation.uniqueIdentifier, "SYNTHETIC-ACCOUNT");
});
