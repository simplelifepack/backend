import assert from "node:assert/strict";
import { test } from "node:test";
import type { Document } from "@prisma/client";
import { toDocumentResponseDto } from "./documents.helpers";
const document = (overrides: Partial<Document> = {}) => ({
  id: "synthetic-document", ownerProfileId: "account", targetProfileId: "account",
  originalName: "synthetic.pdf", title: null, uniqueIdentifier: null, rawText: null,
  extractedKeyFields: {}, fields: {}, documentType: "driving_licence", normalizedType: "driving_licence",
  ownershipStatus: "unknown", sourceProvider: "DIGILOCKER", ...overrides,
}) as Document;
test("account-filed imports expose matching relationship and capabilities without claiming ownership verification", () => {
  const result = toDocumentResponseDto(document());
  assert.equal(result.owner, "self");
  assert.equal(result.ownershipStatus, "unknown");
  assert(result.capabilities.includes("driving_authorization"));
  assert(result.capabilities.includes("identity_proof"));
  assert(result.capabilities.includes("address_proof"));
});
test("explicit relationships, unknown profile targets and ownership mismatches are preserved", () => {
  assert.equal(toDocumentResponseDto(document({ fields: { owner: "spouse" } })).owner, "spouse");
  assert.equal(toDocumentResponseDto(document({ fields: { owner: "unknown" } })).owner, "unknown");
  assert.equal(toDocumentResponseDto(document({ targetProfileId: "other-profile" })).owner, "unknown");
  assert.equal(toDocumentResponseDto(document({ targetProfileId: null })).owner, "unknown");
  assert.equal(toDocumentResponseDto(document({ ownershipStatus: "mismatch" })).owner, "unknown");
});
test("canonical capabilities are provided for all supported document types", () => {
  for (const type of ["aadhaar", "pan", "passport", "driving_licence", "voter_id"]) {
    assert(toDocumentResponseDto(document({ documentType: type, normalizedType: type })).capabilities.includes("identity_proof"), type);
  }
});
