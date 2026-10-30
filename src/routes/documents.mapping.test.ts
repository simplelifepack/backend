import assert from "node:assert/strict";
import { test } from "node:test";
import type { Document } from "@prisma/client";
import { normalizeDocumentType } from "../services/readiness/normalization";
import { documentDefinitions } from "../services/documents/fieldDefinitions";
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
  for (const type of ["aadhaar", "pan", "pan_verification_record", "passport", "driving_licence", "voter_id"]) {
    assert(toDocumentResponseDto(document({ documentType: type, normalizedType: type })).capabilities.includes("identity_proof"), type);
  }
});

for (const [type, definition] of Object.entries(documentDefinitions)) {
  test(`catalogue mapping: ${type}`, () => {
    const result = toDocumentResponseDto(document({ documentType: type, normalizedType: type }));
    assert.equal(result.owner, "self");
    assert.equal(result.normalizedType, type);
    assert.equal(normalizeDocumentType(definition.displayName), type);
    for (const capability of definition.supportedReadinessCapabilities) assert(result.capabilities.includes(capability), `${type}: ${capability}`);
  });
}
test("unlisted types retain exact matching without acquiring unrelated identity capabilities", () => {
  const result = toDocumentResponseDto(document({ documentType: "custom_farm_certificate", normalizedType: "custom_farm_certificate" }));
  assert.deepEqual(result.capabilities, ["custom_farm_certificate"]);
});

test("legacy aliases expose canonical type codes for exact package matching on every client", () => {
  for (const [alias, canonical] of [["driver_license", "driving_licence"], ["pan_verification_record", "pan"], ["FD Certificate", "fixed_deposit"], ["Tax Receipt", "property_tax_receipt"]]) {
    assert.equal(toDocumentResponseDto(document({ normalizedType: alias, documentType: alias })).normalizedType, canonical);
  }
});
