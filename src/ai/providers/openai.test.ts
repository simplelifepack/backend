import assert from "node:assert/strict";
import { validateIntentAnalysis } from "./openai";

for (const malformed of [null, {}, { packageName: "x", category: "x", description: "x", requiredDocuments: [] }]) {
  assert.throws(() => validateIntentAnalysis(malformed));
}
