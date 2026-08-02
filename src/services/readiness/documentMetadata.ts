import type { DocumentOwner, NormalizedDocumentMetadata } from "./metadataTypes";
import { normalizeDocumentType } from "./normalization";

const owners = new Set<DocumentOwner>([
  "self", "spouse", "father", "mother", "child", "seller", "buyer",
  "employer", "bank", "hospital", "government", "other", "unknown",
]);

export function buildDocumentMetadata(document: {
  id: string;
  documentType: string;
  normalizedType: string | null;
  fields: unknown;
}, unknownOwnerFallback?: DocumentOwner): NormalizedDocumentMetadata {
  const fields = objectValue(document.fields);
  const storedOwner = owners.has(fields.owner as DocumentOwner) ? fields.owner as DocumentOwner : "self";
  const owner = storedOwner === "unknown" && unknownOwnerFallback ? unknownOwnerFallback : storedOwner;
  const expiry = firstString(fields, ["expiry", "expiryDate", "dateOfExpiry", "validTill", "validUpto"]);
  const subType = firstString(fields, ["subType", "documentSubType"]);
  const documentDate = firstString(fields, ["documentDate", "statementDate", "issueDate", "date", "month"]);
  const attributes = scalarAttributes(fields);
  if (documentDate) attributes.documentDate = documentDate;
  return {
    documentId: document.id,
    documentType: normalizeDocumentType(document.normalizedType ?? document.documentType),
    owner,
    subType,
    expiry,
    verified: typeof fields.verified === "boolean" ? fields.verified : true,
    attributes,
  };
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
