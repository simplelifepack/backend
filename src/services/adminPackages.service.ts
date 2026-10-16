import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { invalidatePackageCatalogueCaches } from "./packs.service";
import { activeRequirementsWhere } from "./readiness/activeRequirements";
import { normalizeRequirementDocumentTypes, slugify } from "./readiness/normalization";
import bcrypt from "bcrypt";

export const PACKAGES_ADMIN_EMAIL = "admin@readines.com";
const SYSTEM_PACK_CREATORS = ["seed", "ai"];
const CSV_COLUMNS = [
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

function looksLikeUrl(value: string) {
  return /https?:\/\//i.test(value);
}

const sourceTypeSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return looksLikeUrl(trimmed) ? undefined : trimmed;
}, z.string().max(80).optional());

const sourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(500),
  name: z.string().trim().max(160).optional(),
  organization: z.string().trim().max(160).optional(),
  type: sourceTypeSchema,
  retrievedAt: z.string().trim().max(40).optional(),
}).strict();

const requirementInputSchema = z.object({
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

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function splitList(value: string | undefined) {
  return value?.split("|").map((item) => item.trim()).filter(Boolean) ?? [];
}

function searchMetadata(input: PackageAdminInput) {
  return {
    ...(input.searchMetadata ?? {}),
    ...(input.country ? { country: input.country } : {}),
    ...(input.applicability ? { applicability: input.applicability } : {}),
  };
}

function verificationSources(input: PackageAdminInput) {
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

function requirementData(input: PackageAdminInput["requirements"][number], index: number) {
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

function adminSelect() {
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

export async function provisionPackagesAdminFromEnv() {
  const password = process.env.PACKAGES_ADMIN_INITIAL_PASSWORD;
  if (!password) throw new Error("PACKAGES_ADMIN_INITIAL_PASSWORD is required.");
  if (password.length < 8) throw new Error("PACKAGES_ADMIN_INITIAL_PASSWORD must be at least 8 characters.");
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email: PACKAGES_ADMIN_EMAIL },
    create: { email: PACKAGES_ADMIN_EMAIL, name: "Packages Admin", passwordHash },
    update: { passwordHash, name: "Packages Admin", authVersion: { increment: 1 } },
    select: { id: true, email: true },
  });
  return user;
}

export async function listAdminPackages(options: { category?: string; limit: number; page: number; search?: string }) {
  const page = Math.max(1, options.page);
  const limit = Math.min(Math.max(1, options.limit), 100);
  const terms = options.search?.trim().split(/\s+/).filter(Boolean) ?? [];
  const where: Prisma.ReadinessPackWhereInput = {
    createdBy: { in: SYSTEM_PACK_CREATORS },
    deletedAt: null,
    ...(options.category ? { category: options.category } : {}),
    ...(terms.length ? {
      AND: terms.map((term) => ({
        OR: [
          { title: { contains: term, mode: "insensitive" as const } },
          { category: { contains: term, mode: "insensitive" as const } },
          { description: { contains: term, mode: "insensitive" as const } },
          { slug: { contains: slugify(term), mode: "insensitive" as const } },
        ],
      })),
    } : {}),
  };
  const [total, items, categories] = await Promise.all([
    prisma.readinessPack.count({ where }),
    prisma.readinessPack.findMany({
      where,
      select: adminSelect(),
      orderBy: [{ category: "asc" }, { title: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.readinessPack.findMany({
      where: { createdBy: { in: SYSTEM_PACK_CREATORS }, deletedAt: null },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
  ]);
  return { items, categories: categories.map((item) => item.category), pagination: { page, limit, total, hasNextPage: page * limit < total } };
}

export async function getAdminPackage(slug: string) {
  return prisma.readinessPack.findFirst({
    where: { slug: slugify(slug), createdBy: { in: SYSTEM_PACK_CREATORS }, deletedAt: null },
    select: adminSelect(),
  });
}

export async function createAdminPackage(input: PackageAdminInput) {
  const slug = slugify(input.slug || input.title);
  const duplicate = await prisma.readinessPack.findFirst({ where: { OR: [{ slug }, { title: { equals: input.title, mode: "insensitive" } }], deletedAt: null }, select: { id: true } });
  if (duplicate) throw Object.assign(new Error("A package with this slug or title already exists."), { statusCode: 409 });
  const pack = await prisma.readinessPack.create({
    data: {
      slug,
      title: input.title,
      subtitle: input.subtitle || null,
      category: input.category,
      aliases: input.aliases,
      description: input.description,
      keywords: input.keywords.length ? input.keywords : [...new Set([input.title, input.category, ...input.aliases].flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean))],
      searchMetadata: searchMetadata(input) as Prisma.InputJsonValue,
      sourceType: input.sourceType || "curated",
      sourceName: input.sourceName || null,
      sourceTitle: input.sourceTitle || null,
      sourceUrl: input.sourceUrl || null,
      lastCheckedAt: parseDate(input.lastCheckedAt),
      verificationSources: verificationSources(input) as Prisma.InputJsonValue,
      lastVerifiedAt: parseDate(input.lastVerifiedAt ?? input.lastCheckedAt),
      verificationStatus: input.verificationStatus || "verified",
      createdBy: "seed",
      version: 1,
      requirements: { create: input.requirements.map(requirementData) },
    },
    select: adminSelect(),
  });
  invalidatePackageCatalogueCaches();
  return pack;
}

export async function updateAdminPackage(slug: string, input: PackageAdminInput) {
  const existing = await prisma.readinessPack.findFirst({
    where: { slug: slugify(slug), createdBy: { in: SYSTEM_PACK_CREATORS }, deletedAt: null },
    include: { requirements: true },
  });
  if (!existing) return null;
  const nextSlug = slugify(input.slug || existing.slug || input.title);
  const duplicate = await prisma.readinessPack.findFirst({
    where: { id: { not: existing.id }, deletedAt: null, OR: [{ slug: nextSlug }, { title: { equals: input.title, mode: "insensitive" } }] },
    select: { id: true },
  });
  if (duplicate) throw Object.assign(new Error("A package with this slug or title already exists."), { statusCode: 409 });
  const keepRequirementIds = new Set(input.requirements.flatMap((item) => item.id ? [item.id] : []));
  await prisma.$transaction(async (tx) => {
    await tx.readinessPack.update({
      where: { id: existing.id },
      data: {
        slug: nextSlug,
        title: input.title,
        subtitle: input.subtitle || null,
        category: input.category,
        aliases: input.aliases,
        description: input.description,
        keywords: input.keywords,
        searchMetadata: searchMetadata(input) as Prisma.InputJsonValue,
        sourceType: input.sourceType || "curated",
        sourceName: input.sourceName || null,
        sourceTitle: input.sourceTitle || null,
        sourceUrl: input.sourceUrl || null,
        lastCheckedAt: parseDate(input.lastCheckedAt),
        verificationSources: verificationSources(input) as Prisma.InputJsonValue,
        lastVerifiedAt: parseDate(input.lastVerifiedAt ?? input.lastCheckedAt),
        verificationStatus: input.verificationStatus || "verified",
        version: { increment: 1 },
      },
    });
    await tx.requirement.updateMany({
      where: { packId: existing.id, id: { notIn: [...keepRequirementIds] }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    for (const [index, requirement] of input.requirements.entries()) {
      const data = requirementData(requirement, index);
      if (requirement.id && existing.requirements.some((item) => item.id === requirement.id)) {
        await tx.requirement.update({ where: { id: requirement.id }, data });
      } else {
        await tx.requirement.create({ data: { ...data, packId: existing.id } });
      }
    }
  });
  invalidatePackageCatalogueCaches();
  return getAdminPackage(nextSlug);
}

export async function deleteAdminPackage(slug: string) {
  const result = await prisma.readinessPack.updateMany({
    where: { slug: slugify(slug), createdBy: { in: SYSTEM_PACK_CREATORS }, deletedAt: null },
    data: { deletedAt: new Date(), version: { increment: 1 } },
  });
  if (result.count) invalidatePackageCatalogueCaches();
  return result.count > 0;
}

export function csvTemplate() {
  const requirements = JSON.stringify([{ title: "Identity proof", required: true, group: "Required", documentType: "identity_proof", owner: "self", acceptedDocumentTypes: ["identity_proof"], alternativeLabels: ["ID proof"] }]);
  const sources = JSON.stringify([{ title: "Official checklist", name: "Issuing authority", url: "https://example.gov/checklist", type: "government" }]);
  return `${CSV_COLUMNS.join(",")}\n${[
    "Example Package",
    "example-package",
    "Short subtitle",
    "Government",
    "Documents needed for the example process.",
    "India",
    "Residents applying online",
    "Example|Sample",
    "example|checklist",
    "government",
    "Issuing authority",
    "Official checklist",
    "https://example.gov/checklist",
    "2026-10-11",
    "verified",
    requirements,
    sources,
  ].map(csvCell).join(",")}\n`;
}

export function previewCsv(csv: string) {
  const rows = parseCsv(csv);
  const header = rows.shift()?.map((value) => value.trim()) ?? [];
  const missing = CSV_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length) return { rows: [], summary: { valid: 0, invalid: 1 }, errors: [`Missing columns: ${missing.join(", ")}`] };
  const seen = new Set<string>();
  const previews = rows.filter((row) => row.some(Boolean)).map((row, index) => {
    const record = Object.fromEntries(header.map((column, columnIndex) => [column, row[columnIndex] ?? ""]));
    const errors: string[] = [];
    let input: PackageAdminInput | null = null;
    try {
      input = packageAdminInputSchema.parse({
        aliases: splitList(record.aliases),
        applicability: record.applicability || undefined,
        category: record.category,
        country: record.country || undefined,
        description: record.description,
        keywords: splitList(record.keywords),
        lastCheckedAt: record.lastCheckedAt || undefined,
        requirements: JSON.parse(record.requirementsJson || "[]"),
        slug: record.slug || undefined,
        sourceName: record.sourceName || undefined,
        sourceTitle: record.sourceTitle || undefined,
        sourceType: record.sourceType || undefined,
        sourceUrl: record.sourceUrl || undefined,
        sources: JSON.parse(record.sourcesJson || "[]"),
        subtitle: record.subtitle || undefined,
        title: record.title,
        verificationStatus: record.verificationStatus || undefined,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid row.");
    }
    const key = slugify(input?.slug || input?.title || record.slug || record.title);
    if (!key) errors.push("Package slug or title is required.");
    if (seen.has(key)) errors.push("Duplicate in CSV.");
    seen.add(key);
    return { rowNumber: index + 2, input, slug: key, title: input?.title ?? record.title, errors };
  });
  return {
    rows: previews,
    summary: { valid: previews.filter((row) => !row.errors.length).length, invalid: previews.filter((row) => row.errors.length).length },
    errors: [],
  };
}

export async function previewCsvWithDatabase(csv: string) {
  const preview = previewCsv(csv);
  const slugs = preview.rows.map((row) => row.slug).filter(Boolean);
  const titles = preview.rows.map((row) => row.input?.title).filter((value): value is string => Boolean(value));
  if (!slugs.length && !titles.length) return preview;
  const duplicates = await prisma.readinessPack.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(slugs.length ? [{ slug: { in: slugs } }] : []),
        ...(titles.length ? titles.map((title) => ({ title: { equals: title, mode: "insensitive" as const } })) : []),
      ],
    },
    select: { slug: true, title: true },
  });
  if (!duplicates.length) return preview;
  const duplicateSlugs = new Set(duplicates.map((item) => item.slug));
  const duplicateTitles = new Set(duplicates.map((item) => item.title.toLowerCase()));
  const rows = preview.rows.map((row) => {
    const errors = [...row.errors];
    if (duplicateSlugs.has(row.slug) || (row.input && duplicateTitles.has(row.input.title.toLowerCase()))) errors.push("Duplicate existing package.");
    return { ...row, errors: [...new Set(errors)] };
  });
  return {
    ...preview,
    rows,
    summary: { valid: rows.filter((row) => !row.errors.length).length, invalid: rows.filter((row) => row.errors.length).length },
  };
}

export async function importCsv(csv: string) {
  const preview = previewCsv(csv);
  const results = await Promise.all(preview.rows.map(async (row) => {
    if (row.errors.length || !row.input) return { rowNumber: row.rowNumber, status: "failed" as const, errors: row.errors };
    const duplicate = await prisma.readinessPack.findFirst({
      where: { deletedAt: null, OR: [{ slug: row.slug }, { title: { equals: row.input.title, mode: "insensitive" } }] },
      select: { id: true },
    });
    if (duplicate) return { rowNumber: row.rowNumber, status: "failed" as const, errors: ["Duplicate existing package."] };
    try {
      await createAdminPackage(row.input);
      return { rowNumber: row.rowNumber, status: "created" as const, errors: [] };
    } catch (error) {
      return { rowNumber: row.rowNumber, status: "failed" as const, errors: [error instanceof Error ? error.message : "Import failed."] };
    }
  }));
  return {
    results,
    successCount: results.filter((row) => row.status === "created").length,
    failedCount: results.filter((row) => row.status === "failed").length,
  };
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]!;
    const next = csv[index + 1];
    if (quoted && char === "\"" && next === "\"") { cell += "\""; index += 1; continue; }
    if (char === "\"") { quoted = !quoted; continue; }
    if (!quoted && char === ",") { row.push(cell); cell = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = ""; continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}
