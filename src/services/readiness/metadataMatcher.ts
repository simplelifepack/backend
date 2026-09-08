import type {
  MetadataMatchState,
  NormalizedDocumentMetadata,
  ReadinessRequirementMetadata,
} from "./metadataTypes";

export type MetadataMatchResult = {
  state: MetadataMatchState;
  document: NormalizedDocumentMetadata | null;
  relatedDocuments: NormalizedDocumentMetadata[];
  reason: string | null;
};

export function matchRequirementMetadata(
  requirement: ReadinessRequirementMetadata,
  documents: NormalizedDocumentMetadata[],
  now = new Date(),
): MetadataMatchResult {
  const acceptedTypes = new Set([requirement.documentType, ...requirement.acceptedDocumentTypes]);
  const requiredCapabilities = new Set(requirement.requiredCapabilities);
  const relatedDocuments = documents.filter((document) =>
    acceptedTypes.has(document.documentType) || document.capabilities.some((capability) => requiredCapabilities.has(capability)));
  if (!relatedDocuments.length) return result("missing", null, [], null);

  const ownerMatches = relatedDocuments.filter((document) => document.owner === requirement.owner);
  if (!ownerMatches.length) {
    const available = relatedDocuments[0]!;
    const documentLabel = requirement.title.replace(new RegExp(`^${ownerLabel(requirement.owner)}\\s+`, "i"), "");
    return result(
      "partial",
      null,
      relatedDocuments,
      `${ownerLabel(available.owner)} ${documentLabel} available but ${ownerLabel(requirement.owner)} ${documentLabel} required.`,
    );
  }

  const evaluations = ownerMatches.map((document) => ({ document, issue: validityIssue(document, requirement, now) }));
  const ready = evaluations.find((evaluation) => !evaluation.issue);
  if (ready) return result("ready", ready.document, relatedDocuments, null);
  return result("partial", null, relatedDocuments, evaluations[0]?.issue ?? "Document needs attention.");
}

function validityIssue(document: NormalizedDocumentMetadata, requirement: ReadinessRequirementMetadata, now: Date) {
  if (!document.verified) return `${requirement.title} is not verified.`;
  if (document.attributes.pagesComplete === false) return `${requirement.title} has missing pages.`;
  if (document.expiry) {
    const expiry = new Date(document.expiry);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < now.getTime()) return `Expired ${requirement.title}.`;
  }
  const maxAgeDays = requirement.constraints?.maxAgeDays;
  const documentDate = document.attributes.documentDate;
  if (typeof maxAgeDays === "number" && typeof documentDate === "string") {
    const issuedAt = new Date(documentDate);
    const ageDays = (now.getTime() - issuedAt.getTime()) / 86_400_000;
    if (!Number.isNaN(ageDays) && ageDays > maxAgeDays) return `${requirement.title} is older than ${maxAgeDays} days.`;
  }
  for (const [key, expected] of Object.entries(requirement.constraints ?? {})) {
    if (key === "maxAgeDays") continue;
    const actual = metadataValue(document, key);
    if (actual !== expected) return `${requirement.title} does not satisfy required ${humanize(key)} metadata.`;
  }
  return null;
}

function metadataValue(document: NormalizedDocumentMetadata, key: string) {
  if (key === "subType") return document.subType;
  if (key === "verified") return document.verified;
  return document.attributes[key];
}

function result(state: MetadataMatchState, document: NormalizedDocumentMetadata | null, relatedDocuments: NormalizedDocumentMetadata[], reason: string | null) {
  return { state, document, relatedDocuments, reason };
}

function ownerLabel(owner: string) {
  return owner === "self" ? "Self" : owner.charAt(0).toUpperCase() + owner.slice(1);
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
}
