import type { DocumentOwner } from "../readiness/metadataTypes";
import { prisma } from "../../lib/prisma";
import { decryptJson, decryptString, documentLookupHash, encryptString } from "../../utils/documentEncryption";

export type ExtractedIdentity = {
  fullName: string | null;
  dateOfBirth: string | null;
  documentNumber: string | null;
  verified: boolean;
};

export type OwnershipDecision = {
  owner: DocumentOwner;
  identity: ExtractedIdentity;
  shouldCreateProfile: boolean;
  status: "verified" | "mismatch" | "unknown";
  confidence: number;
  matchedFields: string[];
  mismatchedFields: string[];
  targetProfileId: string;
};

export async function detectIdentityOwnership(userId: string, fields: Record<string, unknown>, documentNumber: string | null, verified: boolean, targetProfileId = userId): Promise<OwnershipDecision> {
  const identity = extractIdentity(fields, documentNumber, verified);
  if (targetProfileId !== userId) {
    return decision("unknown", 0, [], ["targetProfile"], targetProfileId, identity, false);
  }
  const profile = await findOrBootstrapProfile(userId);
  if (!profile) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (
      user?.name &&
      identity.fullName &&
      normalizeNameForMatch(user.name) !== normalizeNameForMatch(identity.fullName)
    ) {
      return decision("mismatch", 95, [], ["fullName"], targetProfileId, identity, false);
    }
    const complete = identity.verified && Boolean(identity.fullName && identity.dateOfBirth && identity.documentNumber);
    return complete
      ? decision("verified", 90, ["fullName", "dateOfBirth", "userConfirmation"], [], targetProfileId, identity, true)
      : decision("unknown", identity.fullName ? 35 : 0, identity.fullName ? ["fullName"] : [], [], targetProfileId, identity, false);
  }
  if (!identity.fullName) return decision("unknown", 0, [], [], targetProfileId, identity, false);
  const sameName = [
    documentLookupHash(normalizeNameForMatch(identity.fullName)),
    documentLookupHash(normalizeName(identity.fullName)),
  ].includes(profile.normalizedNameHash);
  if (!sameName) return decision("mismatch", 95, [], ["fullName"], targetProfileId, identity, false);
  if (!identity.dateOfBirth) return decision("unknown", 55, ["fullName"], [], targetProfileId, identity, false);
  const sameDob = documentLookupHash(normalizeDate(identity.dateOfBirth)) === profile.dateOfBirthHash;
  return sameDob
    ? decision("verified", 100, ["fullName", "dateOfBirth"], [], targetProfileId, identity, false)
    : decision("mismatch", 100, ["fullName"], ["dateOfBirth"], targetProfileId, identity, false);
}

function decision(
  status: OwnershipDecision["status"],
  confidence: number,
  matchedFields: string[],
  mismatchedFields: string[],
  targetProfileId: string,
  identity: ExtractedIdentity,
  shouldCreateProfile: boolean,
): OwnershipDecision {
  return {
    status,
    confidence,
    matchedFields,
    mismatchedFields,
    targetProfileId,
    owner: status === "verified" ? "self" : status === "mismatch" ? "other" : "unknown",
    identity,
    shouldCreateProfile,
  };
}

async function findOrBootstrapProfile(userId: string) {
  const existing = await prisma.userIdentityProfile.findUnique({ where: { userId } });
  if (existing) return existing;
  const documents = await prisma.document.findMany({
    where: {
      ownerProfileId: userId,
      targetProfileId: userId,
      category: "identity",
      classificationStatus: "verified",
      ownershipStatus: "verified",
      deletedAt: null,
    },
    select: { id: true, fields: true, uniqueIdentifier: true },
    orderBy: { createdAt: "asc" },
  });
  for (const document of documents) {
    const fields = decryptJson<Record<string, unknown>>(document.fields, {});
    const identity = extractIdentity(fields, decryptString(document.uniqueIdentifier), fields.verified !== false);
    if (!identity.fullName || !identity.dateOfBirth || !identity.documentNumber || !identity.verified) continue;
    await createIdentityProfile(userId, document.id, {
      owner: "self",
      identity,
      shouldCreateProfile: true,
      status: "verified",
      confidence: 100,
      matchedFields: ["legacyVerifiedDocument"],
      mismatchedFields: [],
      targetProfileId: userId,
    });
    return prisma.userIdentityProfile.findUnique({ where: { userId } });
  }
  return null;
}

export async function createIdentityProfile(userId: string, documentId: string, decision: OwnershipDecision) {
  const { identity } = decision;
  if (!decision.shouldCreateProfile || !identity.fullName || !identity.dateOfBirth || !identity.documentNumber) return;
  await prisma.userIdentityProfile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      fullName: encryptString(identity.fullName)!,
      normalizedNameHash: documentLookupHash(normalizeNameForMatch(identity.fullName))!,
      dateOfBirth: encryptString(identity.dateOfBirth)!,
      dateOfBirthHash: documentLookupHash(normalizeDate(identity.dateOfBirth))!,
      documentNumber: encryptString(identity.documentNumber)!,
      createdFromDocumentId: documentId,
      verified: true,
    },
  });
}

export function extractIdentity(fields: Record<string, unknown>, documentNumber: string | null, verified: boolean): ExtractedIdentity {
  return {
    fullName: firstString(fields, ["fullName", "holderName", "nameOnDocument", "name"]),
    dateOfBirth: firstString(fields, ["dateOfBirth", "dob", "birthDate"]),
    documentNumber: documentNumber ?? firstString(fields, ["documentNumber", "uniqueNumber", "panNumber", "aadhaarNumber", "passportNumber"]),
    verified,
  };
}

export function normalizeName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function normalizeNameForMatch(value: string) {
  return normalizeName(value).split(" ").filter(Boolean).sort().join(" ");
}

export function normalizeDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function compareOwnerIdentity(
  extracted: { fullName: string | null; dateOfBirth: string | null },
  target: { fullName: string; dateOfBirth: string },
  targetProfileId: string,
) {
  const matchedFields: string[] = [];
  const mismatchedFields: string[] = [];
  if (!extracted.fullName) {
    return { status: "unknown" as const, confidence: 0, matchedFields, mismatchedFields, targetProfileId };
  }
  if (normalizeNameForMatch(extracted.fullName) !== normalizeNameForMatch(target.fullName)) {
    mismatchedFields.push("fullName");
    return { status: "mismatch" as const, confidence: 95, matchedFields, mismatchedFields, targetProfileId };
  }
  matchedFields.push("fullName");
  if (!extracted.dateOfBirth) {
    return { status: "unknown" as const, confidence: 55, matchedFields, mismatchedFields, targetProfileId };
  }
  if (normalizeDate(extracted.dateOfBirth) !== normalizeDate(target.dateOfBirth)) {
    mismatchedFields.push("dateOfBirth");
    return { status: "mismatch" as const, confidence: 100, matchedFields, mismatchedFields, targetProfileId };
  }
  matchedFields.push("dateOfBirth");
  return { status: "verified" as const, confidence: 100, matchedFields, mismatchedFields, targetProfileId };
}

export function decryptIdentityProfile(profile: { fullName: string; dateOfBirth: string; documentNumber: string }) {
  return { fullName: decryptString(profile.fullName), dateOfBirth: decryptString(profile.dateOfBirth), documentNumber: decryptString(profile.documentNumber) };
}

function firstString(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
