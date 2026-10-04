import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { findDefaultPackSlug, saveGeneratedDefaultPack } from "../readiness/defaultPacksRepository";
import { searchReadinessPacks } from "../readiness/readiness.service";
import { createIdentityProfile, detectIdentityOwnership, normalizeName } from "./ownershipDetection";

const email = `ownership-default-pack-${crypto.randomUUID()}@example.test`;
const generatedTitle = `Telangana Farm Purchase ${crypto.randomUUID().slice(0, 8)}`;
const checkedAt = new Date("2026-08-06T00:00:00.000Z").toISOString();
let userId: string | null = null;
let generatedSlug: string | null = null;
let ugandaSlug: string | null = null;

async function main() {
try {
  const user = await prisma.user.create({ data: { name: "Ravi Kumar", email, passwordHash: "test-only" } });
  userId = user.id;
  assert.equal(normalizeName("  RÁVI   Kumar "), "ravi kumar");

  const first = await detectIdentityOwnership(user.id, { fullName: "Ravi Kumar", dob: "1990-01-02" }, "ABCDE1234F", true);
  assert.equal(first.owner, "self");
  assert.equal(first.shouldCreateProfile, true);
  await createIdentityProfile(user.id, "test-document", first);

  const self = await detectIdentityOwnership(user.id, { holderName: "RAVI KUMAR", dateOfBirth: "1990-01-02" }, "123456789012", true);
  assert.equal(self.owner, "self");
  const other = await detectIdentityOwnership(user.id, { holderName: "Anita Kumar", dateOfBirth: "1992-03-04" }, "ZZZZZ9999Z", true);
  assert.equal(other.owner, "other");
  const unknown = await detectIdentityOwnership(user.id, { holderName: "Ravi Kumar" }, "S1234567", true);
  assert.equal(unknown.owner, "unknown");

  generatedSlug = await saveGeneratedDefaultPack("buy uncommon farm parcel", {
    packageName: generatedTitle,
    category: "property",
    description: "Cached property readiness pack",
    searchMetadata: { intent: "property purchase", subject: "farm parcel", searchPhrases: ["buy uncommon farm parcel"] },
    sourceTitle: "Registration and Stamps Department Telangana property registration",
    sourceUrl: "https://registration.telangana.gov.in/",
    sourceOrganization: "Registration and Stamps Department Telangana",
    lastChecked: checkedAt,
    verificationSources: [{
      title: "Registration and Stamps Department Telangana property registration",
      organization: "Registration and Stamps Department Telangana",
      url: "https://registration.telangana.gov.in/",
      type: "government",
      retrievedAt: checkedAt,
    }],
    lastVerifiedAt: checkedAt,
    verificationStatus: "verified",
    requiredDocuments: [{ id: "buyer_pan", title: "Buyer PAN Card", name: "Buyer PAN Card", documentType: "pan", owner: "self", category: "Buyer Identity", required: true, whyNeeded: "Officially listed identity evidence.", sourceName: "Registration and Stamps Department Telangana", sourceUrl: "https://registration.telangana.gov.in/", sourceAuthorityTier: "government", lastVerifiedAt: checkedAt }],
  });
  assert.equal(await findDefaultPackSlug("buy uncommon farm parcel"), generatedSlug);
  await saveGeneratedDefaultPack("buy uncommon farm parcel", {
    packageName: generatedTitle,
    category: "property",
    description: "Cached property readiness pack",
    searchMetadata: { intent: "property purchase", subject: "farm parcel", searchPhrases: ["buy uncommon farm parcel"] },
    sourceTitle: "Registration and Stamps Department Telangana property registration",
    sourceUrl: "https://registration.telangana.gov.in/",
    sourceOrganization: "Registration and Stamps Department Telangana",
    lastChecked: checkedAt,
    verificationSources: [{
      title: "Registration and Stamps Department Telangana property registration",
      organization: "Registration and Stamps Department Telangana",
      url: "https://registration.telangana.gov.in/",
      type: "government",
      retrievedAt: checkedAt,
    }],
    lastVerifiedAt: checkedAt,
    verificationStatus: "verified",
    requiredDocuments: [{ id: "buyer_pan", title: "Buyer PAN Card", name: "Buyer PAN Card", documentType: "pan", owner: "self", category: "Buyer Identity", required: true, whyNeeded: "Officially listed identity evidence.", sourceName: "Registration and Stamps Department Telangana", sourceUrl: "https://registration.telangana.gov.in/", sourceAuthorityTier: "government", lastVerifiedAt: checkedAt }],
  });
  assert.equal(await prisma.readinessPack.count({ where: { slug: generatedSlug } }), 1);
  const stored = await prisma.readinessPack.findUnique({ where: { slug: generatedSlug }, include: { requirements: true } });
  assert.equal(stored?.createdBy, "ai");
  assert.equal(stored?.version, 1);
  assert.ok(stored?.aliases.includes("buy uncommon farm parcel"));
  assert.ok((stored?.keywords.length ?? 0) > 0);
  assert.equal(stored?.requirements[0]?.documentType, "pan");
  assert.ok((await searchReadinessPacks("buy uncommon farm parcel")).some((pack) => pack.slug === generatedSlug));
  assert.equal(await prisma.readinessPack.count({ where: { slug: generatedSlug, createdBy: "ai" } }), 1);
  ugandaSlug = await saveGeneratedDefaultPack("uganda", {
    packageName: "Tourist Visa",
    category: "Travel & Visa",
    description: "Uganda tourist visa readiness pack",
    searchMetadata: { intent: "tourist travel", subject: "visitor visa", destination: "Uganda", purpose: "tourism", searchPhrases: ["uganda tourist visa"] },
    sourceTitle: "Uganda electronic visa information",
    sourceUrl: "https://visas.immigration.go.ug/",
    sourceOrganization: "Directorate of Citizenship and Immigration Control, Uganda",
    lastChecked: checkedAt,
    verificationSources: [{
      title: "Uganda electronic visa information",
      organization: "Directorate of Citizenship and Immigration Control, Uganda",
      url: "https://visas.immigration.go.ug/",
      type: "government",
      retrievedAt: checkedAt,
    }],
    lastVerifiedAt: checkedAt,
    verificationStatus: "verified",
    requiredDocuments: [{ id: "passport", title: "Passport", name: "Passport", documentType: "passport", owner: "self", category: "Identity", required: true, whyNeeded: "Required for visa application.", sourceName: "Directorate of Citizenship and Immigration Control, Uganda", sourceUrl: "https://visas.immigration.go.ug/", sourceAuthorityTier: "government", lastVerifiedAt: checkedAt }],
  });
  assert.equal(ugandaSlug, "uganda-tourist-visa");
  const genericTouristVisa = await prisma.readinessPack.findUnique({ where: { slug: "tourist-visa" }, select: { aliases: true, searchMetadata: true } });
  assert.ok(!genericTouristVisa?.aliases.includes("uganda"));
  console.log("Ownership detection and default packs tests passed.");
} finally {
  if (ugandaSlug) await prisma.readinessPack.deleteMany({ where: { slug: ugandaSlug } });
  if (generatedSlug) await prisma.readinessPack.deleteMany({ where: { slug: generatedSlug } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
}

void main();
