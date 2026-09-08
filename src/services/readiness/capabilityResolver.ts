import { getDocumentDefinition } from "../ingestion/documentDefinitions";
import { normalizeDocumentType } from "./normalization";
import type { Prisma } from "@prisma/client";

/** Capabilities common to every explicitly accepted type are safe requirement capabilities. */
export function resolveRequirementCapabilities(documentType: string, acceptedDocumentTypes: string[]) {
  const types = [...new Set([documentType, ...acceptedDocumentTypes].map((type) => normalizeDocumentType(type)))];
  // A capability is only safe when a requirement explicitly accepts multiple
  // document types that all advertise it. A specific singleton requirement
  // (for example Passport) must continue matching its exact normalized type.
  if (types.length < 2) return [];
  const capabilitySets = types.map((type) => new Set(getDocumentDefinition(type).supportedReadinessCapabilities));
  if (!capabilitySets.length) return [];
  return [...capabilitySets[0]!].filter((capability) => capabilitySets.every((set) => set.has(capability)));
}

export const readinessDocumentWhere: Prisma.DocumentWhereInput = {
  deletedAt: null,
  integrityStatus: "passed",
  classificationStatus: { in: ["detected", "verified"] },
  ownershipStatus: { in: ["unknown", "verified"] },
};
