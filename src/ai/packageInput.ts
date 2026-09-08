import { z } from "zod";
import { publicDocumentLabel } from "../services/readiness/normalization";

// Only package intent and exact dictionary labels can enter category A.
// No document records, free-form metadata, credentials, model or tool settings.
const packageQuery = z.string().trim().min(1).max(160).refine(value =>
  !Array.from(value).some(char => "\r\n<>={}[]@".includes(char)) &&
  !/(?:\d[ -]?){6,}/.test(value) &&
  !/\b[A-Z]{5}[0-9]{4}[A-Z]\b/i.test(value) &&
  !/\b[A-Z][0-9]{7}\b/i.test(value) &&
  !/\b(?:data:|base64|salary\s*(?:is|:|=)|account\s*(?:number|no)|address\s*:)/i.test(value),
  "Use a package name or public requirements query without personal document details.",
);
export const packageInputSchema = z.object({
  packageType: packageQuery,
  documentLabels: z.array(z.string().max(100)).max(100).default([]),
}).strict();

export function buildPackageInput(value: unknown) {
  const { packageType, documentLabels } = packageInputSchema.parse(value);
  return {
    packageType,
    availableDocumentLabels: [...new Set(documentLabels.flatMap(label => {
      const allowed = publicDocumentLabel(label);
      return allowed ? [allowed] : [];
    }))].sort(),
  };
}
export type PackageInput = ReturnType<typeof buildPackageInput>;
