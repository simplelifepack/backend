import { withCredentialLookup, withPrivateUser } from "../privacy/access";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { invalidatePackageCatalogueCaches } from "./packs.service";
import { activeRequirementsWhere } from "./readiness/activeRequirements";
import { normalizeRequirementDocumentTypes, slugify } from "./readiness/normalization";
import bcrypt from "bcrypt";




// AI-derived catalogue entries can include legacy user queries/aliases. They are
// excluded from operator APIs until a separate public-content review is complete.
export const SYSTEM_PACK_CREATORS = ["seed"];

export const CSV_COLUMNS = [
  "title",
  "slug",
  "subtitle",
  "category",
  "description",
  "country",
  "applicability",
  "aliases",
  "keywords",
  "sourceType",
  "sourceName",
  "sourceTitle",
  "sourceUrl",
  "lastCheckedAt",
  "verificationStatus",
  "requirementsJson",
  "sourcesJson",
];


export function looksLikeUrl(value: string) {
  return /https?:\/\//i.test(value);
}


export const sourceTypeSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return looksLikeUrl(trimmed) ? undefined : trimmed;
}, z.string().max(80).optional());


export const sourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(500),
  name: z.string().trim().max(160).optional(),
  organization: z.string().trim().max(160).optional(),
  type: sourceTypeSchema,
  retrievedAt: z.string().trim().max(40).optional(),
}).strict();


export const requirementInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  required: z.boolean().default(true),
  group: z.string().trim().min(1).max(120).default("Required"),
  documentType: z.string().trim().max(120).optional(),
  owner: z.string().trim().min(1).max(80).default("self"),
  acceptedDocumentTypes: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  alternativeLabels: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().min(0).optional(),
}).strip();


export const packageAdminInputSchema = z.object({
  aliases: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
  applicability: z.string().trim().max(240).optional(),
  category: z.string().trim().min(1).max(120),
  country: z.string().trim().max(120).optional(),
  description: z.string().trim().min(1).max(2000),
  keywords: z.array(z.string().trim().min(1).max(80)).max(80).default([]),
  lastCheckedAt: z.string().trim().max(40).optional().nullable(),
  lastVerifiedAt: z.string().trim().max(40).optional().nullable(),
  requirements: z.array(requirementInputSchema).min(1).max(80),
  searchMetadata: z.record(z.string(), z.unknown()).optional(),
  slug: z.string().trim().min(1).max(160).optional(),
  sourceName: z.string().trim().max(160).optional().nullable(),
  sourceTitle: z.string().trim().max(200).optional().nullable(),
  sourceType: sourceTypeSchema.nullable(),
  sourceUrl: z.string().trim().url().max(500).optional().nullable(),
  sources: z.array(sourceSchema).max(20).default([]),
  subtitle: z.string().trim().max(240).optional().nullable(),
  title: z.string().trim().min(1).max(160),
  verificationStatus: z.string().trim().max(80).optional().nullable(),
}).strict();


export type PackageAdminInput = z.infer<typeof packageAdminInputSchema>;


export function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}


export function splitList(value: string | undefined) {
  return value?.split("|").map((item) => item.trim()).filter(Boolean) ?? [];
}


export function searchMetadata(input: PackageAdminInput) {
  return {
    ...(input.searchMetadata ?? {}),
    ...(input.country ? { country: input.country } : {}),
    ...(input.applicability ? { applicability: input.applicability } : {}),
  };
}


export function verificationSources(input: PackageAdminInput) {
  if (input.sources.length) return input.sources;
  if (input.sourceTitle && input.sourceUrl) {
    return [{
      title: input.sourceTitle,
      organization: input.sourceName ?? undefined,
      name: input.sourceName ?? undefined,
      url: input.sourceUrl,
      type: input.sourceType ?? "official",
      retrievedAt: input.lastCheckedAt ?? undefined,
    }];
  }
  return [];
}


export function requirementData(input: PackageAdminInput["requirements"][number], index: number) {
  const accepted = input.acceptedDocumentTypes.length
    ? input.acceptedDocumentTypes
    : normalizeRequirementDocumentTypes(input.documentType ?? input.title, input.title);
  return {
    title: input.title,
    description: input.description || input.title,
    required: input.required,
    group: input.group,
    documentType: input.documentType || accepted[0] || "unknown",
    owner: input.owner,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    acceptedDocumentTypes: accepted,
    alternativeLabels: input.alternativeLabels,
    sortOrder: input.sortOrder ?? index,
    deletedAt: null,
  };
}


export function adminSelect() {
  return {
    id: true,
    slug: true,
    title: true,
    subtitle: true,
    category: true,
    aliases: true,
    description: true,
    keywords: true,
    searchMetadata: true,
    sourceType: true,
    sourceName: true,
    sourceTitle: true,
    sourceUrl: true,
    lastCheckedAt: true,
    verificationSources: true,
    lastVerifiedAt: true,
    verificationStatus: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
    version: true,
    requirements: {
      where: activeRequirementsWhere,
      orderBy: { sortOrder: "asc" as const },
      select: {
        id: true,
        title: true,
        description: true,
        required: true,
        group: true,
        documentType: true,
        owner: true,
        metadata: true,
        acceptedDocumentTypes: true,
        alternativeLabels: true,
        sortOrder: true,
      },
    },
  };
}
