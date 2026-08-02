import assert from "node:assert/strict";

import { validateDocumentAIResult } from "./openaiDocumentAnalyzer";

const panResult = validateDocumentAIResult({
  category: "Other",
  documentType: "Unknown",
  uniqueNumber: "abcde1234f",
  nameOnDocument: "Ravi Kumar",
});

assert.deepEqual(panResult, {
  category: "Identity",
  documentType: "PAN Card",
  uniqueNumber: "ABCDE1234F",
  nameOnDocument: "Ravi Kumar",
});

const passportResult = validateDocumentAIResult({
  category: "Identity",
  documentType: "Unknown",
  uniqueNumber: "s2326451",
  nameOnDocument: null,
});

assert.deepEqual(passportResult, {
  category: "Identity",
  documentType: "Passport",
  uniqueNumber: "S2326451",
  nameOnDocument: null,
});

const photoResult = validateDocumentAIResult({
  category: "Photo",
  documentType: "Passport Size Photo",
  uniqueNumber: null,
  nameOnDocument: null,
});

assert.deepEqual(photoResult, {
  category: "Photo",
  documentType: "Passport Size Photo",
  uniqueNumber: null,
  nameOnDocument: null,
});

console.log("document analyzer tests passed");
