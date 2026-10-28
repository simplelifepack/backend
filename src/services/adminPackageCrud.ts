import { withCredentialLookup, withPrivateUser } from "../privacy/access";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { invalidatePackageCatalogueCaches } from "./packs.service";
import { activeRequirementsWhere } from "./readiness/activeRequirements";
import { normalizeRequirementDocumentTypes, slugify } from "./readiness/normalization";
import bcrypt from "bcrypt";
import { SYSTEM_PACK_CREATORS, adminSelect, type PackageAdminInput, searchMetadata, parseDate, verificationSources, requirementData, CSV_COLUMNS, packageAdminInputSchema, splitList } from "./adminPackageSchemas";
import { csvCell, parseCsv } from "./adminPackageCsv";


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
