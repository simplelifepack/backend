import type { DocumentOwner, NormalizedDocumentMetadata } from "./metadataTypes";
import { normalizeDocumentType } from "./normalization";
import { getDocumentDefinition } from "../ingestion/documentDefinitions";

const owners = new Set<DocumentOwner>([
  "self", "spouse", "father", "mother", "child", "seller", "buyer",
  "employer", "bank", "hospital", "government", "other", "unknown",
]);

export function buildDocumentMetadata(document: {
  id: string;
  documentType: string;
  normalizedType: string | null;
  fields: unknown;
  readinessVerified?: boolean;
}, unknownOwnerFallback?: DocumentOwner): NormalizedDocumentMetadata {
  const fields = objectValue(document.fields);
  const storedOwner = owners.has(fields.owner as DocumentOwner) ? fields.owner as DocumentOwner : "self";
  const owner = storedOwner === "unknown" && unknownOwnerFallback ? unknownOwnerFallback : storedOwner;
  const expiry = firstString(fields, ["expiry", "expiryDate", "dateOfExpiry", "validTill", "validUpto"]);
  const subType = firstString(fields, ["subType", "documentSubType"]);
  const documentDate = firstString(fields, ["documentDate", "statementDate", "issueDate", "date", "month"]);
  const attributes = scalarAttributes(fields);
  const documentType = normalizeDocumentType(document.normalizedType ?? document.documentType);
  const storedCapabilities = [...arrayStrings(fields.capabilities), ...arrayStrings(fields.satisfies)];
  const capabilities = [...new Set([
    ...getDocumentDefinition(documentType).supportedReadinessCapabilities,
    ...storedCapabilities.map((value) => normalizeDocumentType(value)),
  ])];
  if (documentDate) attributes.documentDate = documentDate;
  return {
    documentId: document.id,
    documentType,
    capabilities,
    owner,
    subType,
    expiry,
    verified: document.readinessVerified ?? (typeof fields.verified === "boolean" ? fields.verified : true),
    attributes,
  };
}

function arrayStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

export function normalizeDocumentOwner(value: unknown): DocumentOwner {
  return typeof value === "string" && owners.has(value as DocumentOwner) ? value as DocumentOwner : "self";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof fields[key] === "string" && fields[key]) return fields[key] as string;
  return null;
}

function scalarAttributes(fields: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string | number | boolean | null] => {
    const value = entry[1];
    return value === null || ["string", "number", "boolean"].includes(typeof value);
  }));
}
