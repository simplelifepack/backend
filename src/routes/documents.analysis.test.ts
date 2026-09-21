import assert from "node:assert/strict";

import { buildAnalyzeResponse, buildManualValidation, prepareManualFields, safeAnalysis } from "./documents.analysis";
import { saveSchema } from "./documents.helpers";

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

const manualPayload = {
  tempFileIds: ["bc604f4c-5f38-4d9f-849b-72c0efbdafbd"],
  category: "Identity",
  analysisSource: "manual" as const,
};
const categoryOnly = saveSchema.parse(manualPayload);
assert.equal(categoryOnly.documentType, "");
assert.equal(categoryOnly.confidence, 0);
assert.equal(categoryOnly.title, undefined);
const categoryOnlyValidation = buildManualValidation(categoryOnly, prepareManualFields("", {}), "upload.png");
assert.equal(categoryOnlyValidation.canSave, true);
assert.equal(categoryOnlyValidation.category, "identity");
assert.equal(categoryOnlyValidation.uniqueIdentifier, null);
assert.equal(categoryOnlyValidation.displayName, "upload.png");

const panPayload = saveSchema.parse({ ...manualPayload, documentType: "PAN" });
const panWithoutNumber = buildManualValidation(panPayload, prepareManualFields("PAN", {}), "pan.png");
assert.equal(panWithoutNumber.canSave, true);
assert.deepEqual(panWithoutNumber.missingRequiredFields, []);
const panFields = prepareManualFields("PAN", { uniqueNumber: "ABCDE1234F" });
assert.equal(panFields.panNumber, "ABCDE1234F");
const panWithNumber = buildManualValidation(panPayload, panFields, "pan.png");
assert.equal(panWithNumber.uniqueIdentifierField, "panNumber");
assert.equal(panWithNumber.uniqueIdentifier, "ABCDE1234F");

const medicalPayload = saveSchema.parse({ ...manualPayload, category: "Medical" });
assert.equal(buildManualValidation(medicalPayload, prepareManualFields("", {}), "report.png").category, "medical");
assert.equal(saveSchema.safeParse({ ...manualPayload, category: "" }).success, false);

console.log("document analysis response tests passed");
