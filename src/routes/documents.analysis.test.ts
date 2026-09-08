import assert from "node:assert/strict";

import { buildAnalyzeResponse, safeAnalysis } from "./documents.analysis";

const invalid = safeAnalysis({
  category: "Something Else" as "Other",
  documentType: "  ",
  uniqueNumber: null,
  nameOnDocument: null,
  expiryDate: null,
});
assert.equal(invalid.category, "Other");
assert.equal(invalid.documentType, "Unknown");

const response = buildAnalyzeResponse({
  analysis: {
    category: "Insurance",
    documentType: "Motor insurance policy",
    uniqueNumber: "POL-42",
    nameOnDocument: "R K Ranjith",
    expiryDate: "2027-08-26",
  },
  ownership: "mine",
  files: [
    { tempFileId: "first", originalName: "front.png", mimeType: "image/png", size: 10 },
    { tempFileId: "second", originalName: "back.png", mimeType: "image/png", size: 11 },
  ],
});

assert.deepEqual(Object.keys(response).sort(), ["document", "files", "success", "warnings"]);
assert.deepEqual(
  Object.keys(response.document).sort(),
  ["category", "documentType", "expiryDate", "nameOnDocument", "ownership", "title", "uniqueNumber"],
);
assert.equal(response.files.length, 2);
assert.equal(response.document.ownership, "mine");

console.log("document analysis response tests passed");
