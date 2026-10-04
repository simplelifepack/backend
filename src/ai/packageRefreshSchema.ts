import { z } from "zod";

const text = z.string().trim().min(1).max(1000);
const sourceUrl = z.string().refine(value => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "A valid HTTPS source URL is required.");
export const refreshSourcesSchema = z.object({
  sources: z.array(z.object({
    title: text, organization: text, url: sourceUrl,
    type: z.enum(["government", "official", "bank", "university", "insurance", "authority"]),
    scope: z.enum(["national", "state", "provider_specific", "institution_specific", "destination_specific"]),
  }).strict()).min(1).max(6),
}).strict();

export const refreshChecklistSchema = z.object({
  exactProcess: z.boolean(), completeChecklist: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]), disclaimer: text,
  applicability: z.object({
    jurisdiction: z.string().nullable(), destination: z.string().nullable(),
    purpose: z.string().nullable(), passportCountries: z.array(z.string()),
  }).strict(),
  sources: z.array(z.object({ url: sourceUrl, relevance: text, evidence: text }).strict()).min(1).max(6),
  requirements: z.array(z.object({
    existingId: z.string().nullable(), title: text, description: text,
    documentType: text, owner: z.enum(["self", "spouse", "father", "mother", "child", "seller", "buyer", "employer", "bank", "hospital", "government", "other", "unknown"]),
    required: z.boolean(), group: text,
    acceptedDocumentTypes: z.array(text).min(1).max(15), alternativeLabels: z.array(text).max(15),
    condition: z.string().nullable(), maxAgeDays: z.number().int().positive().nullable(),
    sourceUrl, evidence: text,
  }).strict()).min(1).max(40),
}).strict();

export type RefreshChecklist = z.infer<typeof refreshChecklistSchema>;
export type RefreshSource = z.infer<typeof refreshSourcesSchema>["sources"][number] & {
  relevance: string; validationStatus: "validated"; verificationMethod: string;
  checkedAt: string; retrievedAt: string; currentnessStatus: string;
};
