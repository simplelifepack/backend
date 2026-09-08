import assert from "node:assert/strict";
import type { NormalizedDocumentMetadata, ReadinessRequirementMetadata } from "./metadataTypes";
import { validateDocumentMetadata } from "../ingestion/documentDefinitions";
import { matchRequirementMetadata } from "./metadataMatcher";
import { buildDocumentMetadata } from "./documentMetadata";
import { normalizeDocumentType, normalizeRequirementDocumentTypes } from "./normalization";
import { readinessPackSeeds } from "./readinessPackData";
import { resolveRequirementCapabilities } from "./capabilityResolver";

const selfPan = document("self-pan", "PAN Card", "self");
const selfAadhaar = document("self-aadhaar", "Aadhaar", "self");

assert.equal(normalizeDocumentType("PAN Card"), "pan");
assert.equal(normalizeDocumentType("Permanent Account Number"), "pan");
assert.equal(normalizeDocumentType("PAN"), "pan");
assert.equal(normalizeDocumentType("Registered Sale Deed"), "sale_deed");
assert.equal(normalizeDocumentType("Conveyance Deed"), "sale_deed");
assert.equal(normalizeDocumentType("Statement"), "bank_statement");
assert.equal(normalizeDocumentType("passport size"), "passport_photo");
assert.equal(normalizeDocumentType("Passport Size Photo"), "passport_photo");
assert.equal(normalizeDocumentType("passport-sized photograph"), "passport_photo");
assert.equal(normalizeDocumentType("Passport"), "passport");
const passportPhotoValidation = validateDocumentMetadata({ documentType: "passport size" });
assert.equal(passportPhotoValidation.normalizedType, "passport_photo");
assert.equal(passportPhotoValidation.displayName, "Passport Size Photo");
assert.equal(passportPhotoValidation.category, "photo");
assert.deepEqual(passportPhotoValidation.missingRequiredFields, []);
assert.equal(passportPhotoValidation.canSave, true);
assert.deepEqual(normalizeRequirementDocumentTypes("government_id", "PAN Card (Permanent Account Number)"), ["pan"]);
assert.deepEqual(normalizeRequirementDocumentTypes("government_id_address", "Aadhaar Card (UIDAI) — identity and address proof"), ["aadhaar"]);

assert.equal(matchRequirementMetadata(requirement("buyer_pan", "pan", "self", "Buyer PAN Card"), [selfPan]).state, "ready");
const sellerPan = matchRequirementMetadata(requirement("seller_pan", "pan", "seller", "Seller PAN Card"), [selfPan]);
assert.equal(sellerPan.state, "partial");
assert.match(sellerPan.reason ?? "", /Self.*available.*Seller.*required/i);
assert.equal(matchRequirementMetadata(requirement("seller_aadhaar", "aadhaar", "seller", "Seller Aadhaar Card"), [selfAadhaar]).state, "partial");
assert.equal(matchRequirementMetadata(requirement("seller_passport", "passport", "seller", "Seller Passport"), [selfPan]).state, "missing");
assert.equal(buildDocumentMetadata({
  id: "current-profile-aadhaar",
  documentType: "Aadhaar",
  normalizedType: "aadhaar",
  fields: { owner: "unknown", verified: true },
}, "self").owner, "self");
assert.equal(buildDocumentMetadata({
  id: "unresolved-aadhaar",
  documentType: "Aadhaar",
  normalizedType: "aadhaar",
  fields: { owner: "unknown", verified: true },
}).owner, "unknown");

const photographRequirement = requirement("photo", "passport_photo", "self", "Photograph", ["passport_photo", "photo"]);
assert.equal(matchRequirementMetadata(photographRequirement, [document("passport-size", "Passport Size Photo", "self")]).state, "ready");
assert.equal(matchRequirementMetadata(photographRequirement, [document("photograph", "Photograph", "self")]).state, "ready");
assert.equal(matchRequirementMetadata(photographRequirement, [document("photo", "Photo", "self")]).state, "ready");
assert.equal(matchRequirementMetadata(photographRequirement, [document("random", "Bank Statement", "self")]).state, "missing");
assert.equal(matchRequirementMetadata(requirement("identity", "identity_proof", "self", "Identity Proof", ["aadhaar", "passport", "identity_proof"]), [document("passport-size", "Passport Size Photo", "self")]).state, "missing");

const expiredPassport = { ...document("passport", "Passport", "self"), expiry: "2020-01-01" };
const expired = matchRequirementMetadata(requirement("passport", "passport", "self", "Passport"), [expiredPassport], new Date("2026-01-01"));
assert.equal(expired.state, "partial");
assert.match(expired.reason ?? "", /Expired Passport/);

const oldStatement = { ...document("statement", "Bank Statement", "self"), attributes: { documentDate: "2025-01-01" } };
const recentStatementRequirement = { ...requirement("bank", "bank_statement", "self", "Bank Statement"), constraints: { maxAgeDays: 180 } };
const stale = matchRequirementMetadata(recentStatementRequirement, [oldStatement], new Date("2026-01-01"));
assert.equal(stale.state, "partial");
assert.match(stale.reason ?? "", /older than 180 days/);

const missingPages = { ...document("deed", "Sale Deed", "self"), attributes: { pagesComplete: false } };
const incomplete = matchRequirementMetadata(requirement("deed", "sale_deed", "self", "Sale Deed"), [missingPages]);
assert.equal(incomplete.state, "partial");
assert.match(incomplete.reason ?? "", /missing pages/);

const propertyPurchase = readinessPackSeeds.find((pack) => pack.slug === "property-purchase");
const sellerPanRequirement = propertyPurchase?.requirements.find((requirement) => requirement.title === "Seller PAN Card");
assert.equal(sellerPanRequirement?.documentType, "pan");
assert.equal(sellerPanRequirement?.owner, "seller");

console.log("Metadata readiness matcher tests passed.");

function document(documentId: string, documentType: string, owner: NormalizedDocumentMetadata["owner"]): NormalizedDocumentMetadata {
  const normalizedType = normalizeDocumentType(documentType);
  return { documentId, documentType: normalizedType, capabilities: buildDocumentMetadata({ id: documentId, documentType, normalizedType, fields: {} }).capabilities, owner, subType: null, expiry: null, verified: true, attributes: {} };
}

function requirement(id: string, documentType: string, owner: ReadinessRequirementMetadata["owner"], title: string, acceptedDocumentTypes = [documentType]): ReadinessRequirementMetadata {
  return { id, documentType, acceptedDocumentTypes, requiredCapabilities: resolveRequirementCapabilities(documentType, acceptedDocumentTypes), owner, title, category: "Identity", required: true };
}
