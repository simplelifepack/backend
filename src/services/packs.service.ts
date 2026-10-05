/* eslint-disable max-lines */
import type { Prisma } from "@prisma/client";
import { performance } from "node:perf_hooks";

import { prisma } from "../lib/prisma";
import { activeRequirementsWhere } from "./readiness/activeRequirements";
import { normalizeDocumentType, normalizeRequirementDocumentTypes, slugify } from "./readiness/normalization";
import { scorePackDetailed } from "./readiness/readinessScoring";
import type { PackScore } from "./readiness/readinessScoring";

export type PackageListOptions = {
  category?: string;
  limit: number;
  location?: string;
  page: number;
  provider?: string;
  search?: string;
  sort: "category" | "newest" | "relevance" | "title";
  userId?: string;
};

export type PackageListTiming = {
  dbAcquireMs?: number;
  ensureMs?: number;
  categoriesQueryMs?: number;
  countQueryMs?: number;
  packsQueryMs?: number;
  relationLoadMs?: number;
  assignmentsQueryMs?: number;
  filterScoreMs?: number;
  transformMs?: number;
};

type RequirementAssignmentDto = {
  assignmentSource: string;
  documentId: string;
  overriddenAt: string | null;
};

const SYSTEM_PACK_CREATORS = ["seed", "ai"];
const STATIC_CATALOGUE_CACHE_MS = 60_000;
let ensureCache: { expiresAt: number; value: number } | null = null;
let categoriesCache: { expiresAt: number; value: string[] } | null = null;

async function timed<T>(timing: PackageListTiming | undefined, key: keyof PackageListTiming, work: () => Promise<T>) {
  const start = performance.now();
  try {
    return await work();
  } finally {
    if (timing) timing[key] = performance.now() - start;
  }
}

async function getRequirementAssignmentMap(userId: string | undefined, requirementIds: string[], timing?: PackageListTiming) {
  if (!userId || !requirementIds.length) return new Map<string, RequirementAssignmentDto>();
  const assignments = await timed(timing, "assignmentsQueryMs", () => prisma.requirementAssignment.findMany({
    where: {
      userId,
      requirementId: { in: requirementIds },
      document: { ownerProfileId: userId, deletedAt: null },
    },
    select: {
      requirementId: true,
      documentId: true,
      assignmentSource: true,
      overriddenAt: true,
    },
  }));
  return new Map(assignments.map((assignment) => [assignment.requirementId, {
    assignmentSource: assignment.assignmentSource,
    documentId: assignment.documentId,
    overriddenAt: assignment.overriddenAt?.toISOString() ?? null,
  }]));
}

function assignmentPayload(assignments: Map<string, RequirementAssignmentDto>, requirementId: string) {
  const assignment = assignments.get(requirementId);
  return assignment ? { assignment } : {};
}

export async function ensureReadinessPacks() {
  const now = Date.now();
  if (ensureCache && ensureCache.expiresAt > now) return ensureCache.value;
  const value = await prisma.readinessPack.count({ take: 1 });
  ensureCache = { value, expiresAt: now + STATIC_CATALOGUE_CACHE_MS };
  return value;
}

export async function getPackageDefinitions() {
  await ensureReadinessPacks();
  return prisma.readinessPack.findMany({
    select: {
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
      createdAt: true,
      createdBy: true,
      version: true,
      requirements: {
        where: activeRequirementsWhere,
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
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });
}

export async function listPackageSummaries(options: PackageListOptions, timing?: PackageListTiming) {
  if (timing) await timed(timing, "dbAcquireMs", () => prisma.$queryRaw`select 1`);
  if (timing) timing.ensureMs = 0;
  const page = Math.max(1, options.page);
  const limit = Math.min(Math.max(1, options.limit), 200);
  const categories = await timed(timing, "categoriesQueryMs", () => getPackageCategories());
  const filters = [options.search, options.provider, options.location]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const customOnly = options.category === "My packs";
  const hasCategoryFilter = Boolean(options.category?.trim() && options.category !== "All" && !customOnly);
  const visibleWhere = options.userId
    ? { OR: [{ createdBy: { in: SYSTEM_PACK_CREATORS } }, { createdBy: options.userId }] }
    : { createdBy: { in: SYSTEM_PACK_CREATORS } };
  const where: Prisma.ReadinessPackWhereInput = customOnly && options.userId ? { createdBy: options.userId } : visibleWhere;
  const defaultListWhere: Prisma.ReadinessPackWhereInput = hasCategoryFilter
    ? { AND: [where, { category: options.category }] }
    : where;
  const compactListSelect = {
    id: true,
    slug: true,
    title: true,
    subtitle: true,
    category: true,
    description: true,
    searchMetadata: true,
    createdBy: true,
    createdAt: true,
    requirements: {
      where: activeRequirementsWhere,
      select: {
        id: true,
        title: true,
        required: true,
        owner: true,
        metadata: true,
        acceptedDocumentTypes: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: "asc" as const },
    },
  };
  const searchSelect = {
    id: true,
    slug: true,
    title: true,
    subtitle: true,
    category: true,
    aliases: true,
    description: true,
    keywords: true,
    searchMetadata: true,
    sourceName: true,
    sourceTitle: true,
    sourceUrl: true,
    verificationSources: true,
    verificationStatus: true,
    lastVerifiedAt: true,
    lastCheckedAt: true,
    createdBy: true,
    createdAt: true,
    requirements: {
      where: activeRequirementsWhere,
      select: {
        id: true,
        title: true,
        description: true,
        required: true,
        group: true,
        owner: true,
        metadata: true,
        acceptedDocumentTypes: true,
      },
      orderBy: { sortOrder: "asc" as const },
    },
  };
  const orderBy = options.sort === "newest"
    ? [{ createdAt: "desc" as const }]
    : [{ category: "asc" as const }, { title: "asc" as const }];

  if (!filters.length && options.sort !== "relevance") {
    const countPromise = timed(timing, "countQueryMs", () => prisma.readinessPack.count({ where: defaultListWhere }));
    const packsPromise = timed(timing, "packsQueryMs", () => prisma.readinessPack.findMany({
      where: defaultListWhere,
      select: compactListSelect,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }));
    const [total, packs] = await Promise.all([
      countPromise,
      packsPromise,
    ]);
    if (timing) timing.relationLoadMs = timing.packsQueryMs;
    const assignments = await getRequirementAssignmentMap(options.userId, packs.flatMap((pack) => pack.requirements.map((requirement) => requirement.id)), timing);
    const transformStart = performance.now();
    const response = toPaginatedPackageResponse(packs, total, page, limit, options.search, undefined, assignments, categories);
    if (timing) timing.transformMs = performance.now() - transformStart;
    return response;
  }

  const packs = await timed(timing, "packsQueryMs", () => prisma.readinessPack.findMany({ where, select: searchSelect, orderBy }));
  if (timing) timing.relationLoadMs = timing.packsQueryMs;
  const filterStart = performance.now();
  const filtered = packs
    .filter((pack) => !hasCategoryFilter || packageCategoryMatches(pack.category, options.category!))
    .map((pack) => {
      const scores = filters.map((filter) => scorePackDetailed(pack, filter));
      const score = scores.length
        ? scores.reduce((total, item) => total + item.score, 0)
        : 1;
      return { pack, score, scoreDetail: scores[0] };
    })
    .filter(({ score, scoreDetail }) => !filters.length || isConfidentSearchScore(scoreDetail) || score >= 70)
    .sort((left, right) => {
      if (options.sort === "newest") return right.pack.createdAt.getTime() - left.pack.createdAt.getTime();
      return right.score - left.score || left.pack.title.localeCompare(right.pack.title);
    });
  if (timing) timing.filterScoreMs = performance.now() - filterStart;
  const pagePacks = filtered.slice((page - 1) * limit, page * limit).map(({ pack }) => pack);
  const assignments = await getRequirementAssignmentMap(options.userId, pagePacks.flatMap((pack) => pack.requirements.map((requirement) => requirement.id)), timing);
  const transformStart = performance.now();
  const response = toPaginatedPackageResponse(
    pagePacks,
    filtered.length,
    page,
    limit,
    options.search,
    new Map(filtered.map(({ pack, scoreDetail }) => [pack.slug, scoreDetail]).filter((entry): entry is [string, PackScore] => Boolean(entry[1]))),
    assignments,
    categories,
  );
  if (timing) timing.transformMs = performance.now() - transformStart;
  return response;
}

async function getPackageCategories() {
  const now = Date.now();
  if (categoriesCache && categoriesCache.expiresAt > now) return categoriesCache.value;
  const rows = await prisma.readinessPack.findMany({
    where: { createdBy: "seed" },
    select: { category: true, searchMetadata: true },
  });
  const byCategory = new Map<string, { order: number; title: string }>();
  rows.forEach((row) => {
    if (!row.category) return;
    const metadata = row.searchMetadata && typeof row.searchMetadata === "object"
      ? row.searchMetadata as Record<string, unknown>
      : {};
    if (metadata.referenceSource !== "App.tsx EVENTS") return;
    const categoryOrder = typeof metadata.categoryOrder === "number" ? metadata.categoryOrder : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(categoryOrder)) return;
    const existing = byCategory.get(row.category);
    if (!existing || categoryOrder < existing.order) byCategory.set(row.category, { order: categoryOrder, title: row.category });
  });
  const value = [...byCategory.values()]
    .sort((left, right) => left.order - right.order)
    .map((item) => item.title);
  categoriesCache = { value, expiresAt: now + STATIC_CATALOGUE_CACHE_MS };
  return value;
}

export async function getReadinessPacksBySlugs(slugs: string[]) {
  await ensureReadinessPacks();
  const uniqueSlugs = [...new Set(slugs.map(slugify).filter(Boolean))].slice(0, 5);
  if (!uniqueSlugs.length) return [];
  const packs = await prisma.readinessPack.findMany({
    where: { slug: { in: uniqueSlugs } },
    select: { id: true, slug: true, title: true, category: true, description: true },
  });
  const bySlug = new Map(packs.map((pack) => [pack.slug, pack]));
  return uniqueSlugs.flatMap((slug) => {
    const pack = bySlug.get(slug);
    return pack ? [pack] : [];
  });
}

const packDefinitionSelect = {
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
  version: true,
  requirements: {
    where: activeRequirementsWhere,
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
    orderBy: { sortOrder: "asc" as const },
  },
};

export async function getReadinessPackDefinitionBySlug(slug: string) {
  await ensureReadinessPacks();
  const normalizedSlug = slugify(slug);
  const exact = await prisma.readinessPack.findUnique({
    where: { slug: normalizedSlug },
    select: packDefinitionSelect,
  });
  if (exact) return exact;

  const packs = await prisma.readinessPack.findMany({
    select: packDefinitionSelect,
  });
  const [best] = packs
    .map((pack) => ({ pack, score: scorePackDetailed(pack, normalizedSlug) }))
    .filter(({ score }) => score.reason !== null && (score.score >= 70 || score.missingTokens.length === 0))
    .sort((left, right) => right.score.score - left.score.score || left.pack.title.localeCompare(right.pack.title));
  return best?.pack ?? null;
}

export async function getReadinessPackDefinitionBySlugForUser(slug: string, userId: string) {
  const pack = await getReadinessPackDefinitionBySlug(slug);
  if (!pack) return null;
  if (!SYSTEM_PACK_CREATORS.includes(pack.createdBy) && pack.createdBy !== userId) return null;
  const assignments = await getRequirementAssignmentMap(userId, pack.requirements.map((requirement) => requirement.id));
  return {
    ...pack,
    requirements: pack.requirements.map((requirement) => ({
      ...requirement,
      ...assignmentPayload(assignments, requirement.id),
    })),
  };
}

export async function getReadinessPackDefinitionByCanonicalSlug(slug: string) {
  await ensureReadinessPacks();
  return prisma.readinessPack.findUnique({
    where: { slug: slugify(slug) },
    select: packDefinitionSelect,
  });
}

export type CustomPackInput = {
  description?: string;
  requirements: string[];
  searchMetadata?: Record<string, unknown>;
  source?: {
    name?: string;
    title?: string;
    url?: string;
    lastCheckedAt?: string;
  };
  title: string;
  verificationSources?: unknown[];
  verificationStatus?: string;
};

export async function createCustomPack(userId: string, input: CustomPackInput) {
  const title = input.title.trim();
  const description = input.description?.trim() || "Custom pack";
  const requirements = cleanRequirementTitles(input.requirements);
  if (!title || !requirements.length) throw new Error("Custom pack name and at least one document are required.");
  const slug = await uniqueUserPackSlug(userId, title);
  await prisma.readinessPack.create({
    data: {
      slug,
      title,
      subtitle: "Custom pack",
      category: "My packs",
      description,
      aliases: [],
      keywords: customPackKeywords(title, description, requirements),
      searchMetadata: customPackMetadata(input.searchMetadata),
      sourceType: "custom",
      sourceName: input.source?.name,
      sourceTitle: input.source?.title,
      sourceUrl: input.source?.url,
      lastCheckedAt: parseOptionalDate(input.source?.lastCheckedAt),
      verificationSources: (input.verificationSources ?? []) as Prisma.InputJsonValue,
      verificationStatus: input.verificationStatus ?? "user_created",
      createdBy: userId,
      version: 1,
      requirements: { create: requirements.map((requirement, index) => customRequirement(slug, requirement, index)) },
    },
  });
  return getReadinessPackDefinitionBySlugForUser(slug, userId);
}

export async function updateCustomPack(userId: string, slug: string, input: CustomPackInput) {
  const existing = await prisma.readinessPack.findUnique({ where: { slug: slugify(slug) }, select: { id: true, slug: true, createdBy: true } });
  if (!existing || existing.createdBy !== userId) return null;
  const title = input.title.trim();
  const description = input.description?.trim() || "Custom pack";
  const requirements = cleanRequirementTitles(input.requirements);
  if (!title || !requirements.length) throw new Error("Custom pack name and at least one document are required.");
  await prisma.$transaction(async (tx) => {
    await tx.requirement.deleteMany({ where: { packId: existing.id } });
    await tx.readinessPack.update({
      where: { id: existing.id },
      data: {
        title,
        description,
        keywords: customPackKeywords(title, description, requirements),
        searchMetadata: customPackMetadata(input.searchMetadata),
        sourceName: input.source?.name,
        sourceTitle: input.source?.title,
        sourceUrl: input.source?.url,
        lastCheckedAt: parseOptionalDate(input.source?.lastCheckedAt),
        verificationSources: (input.verificationSources ?? []) as Prisma.InputJsonValue,
        verificationStatus: input.verificationStatus ?? "user_created",
        version: { increment: 1 },
        requirements: { create: requirements.map((requirement, index) => customRequirement(existing.slug, requirement, index)) },
      },
    });
  });
  return getReadinessPackDefinitionBySlugForUser(existing.slug, userId);
}

export async function deleteCustomPack(userId: string, slug: string) {
  const result = await prisma.readinessPack.deleteMany({ where: { slug: slugify(slug), createdBy: userId } });
  return result.count > 0;
}

function toPaginatedPackageResponse<T extends {
  createdAt: Date;
  createdBy?: string;
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  category: string;
  aliases?: string[];
  keywords?: string[];
  searchMetadata: unknown;
  description: string;
  sourceName?: string | null;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  verificationSources?: unknown;
  verificationStatus?: string | null;
  lastVerifiedAt?: Date | null;
  lastCheckedAt?: Date | null;
  requirements: Array<{
    id: string;
    title: string;
    description?: string;
    required: boolean;
    group?: string;
    owner: string;
    metadata: unknown;
    acceptedDocumentTypes: string[];
  }>;
}>(packs: T[], total: number, page: number, limit: number, query?: string, matchInfo = new Map<string, PackScore>(), assignments = new Map<string, RequirementAssignmentDto>(), categories: string[] = []) {
  const matches = packs.flatMap((pack) => {
    const match = matchInfo.get(pack.slug);
    return match ? [{
      id: pack.id,
      name: pack.title,
      slug: pack.slug,
      matchType: match.reason ?? "keyword_similarity",
      confidence: Math.min(1, Math.round(match.score) / 100),
      matchedTokens: match.matchedTokens,
      missingTokens: match.missingTokens,
    }] : [];
  });
  return {
    query: query ?? "",
    items: packs.map((pack) => ({
      id: pack.id,
      slug: pack.slug,
      title: pack.title,
      ...(pack.subtitle ? { subtitle: pack.subtitle } : {}),
      ...(pack.aliases?.length ? { aliases: pack.aliases } : {}),
      ...(listSearchMetadata(pack.searchMetadata) ? { searchMetadata: listSearchMetadata(pack.searchMetadata) } : {}),
      category: pack.category,
      description: pack.description,
      ...(pack.createdBy ? { createdBy: pack.createdBy } : {}),
      ...(pack.sourceName || pack.sourceTitle || pack.sourceUrl || pack.lastCheckedAt ? { source: {
        ...(pack.sourceName ? { name: pack.sourceName } : {}),
        ...(pack.sourceTitle ? { title: pack.sourceTitle } : {}),
        ...(pack.sourceUrl ? { url: pack.sourceUrl } : {}),
        ...(pack.lastCheckedAt ? { lastCheckedAt: pack.lastCheckedAt.toISOString().slice(0, 10) } : {}),
      } } : {}),
      ...(Array.isArray(pack.verificationSources) ? { verificationSources: pack.verificationSources } : {}),
      ...(pack.verificationStatus ? { verificationStatus: pack.verificationStatus } : {}),
      ...(pack.lastVerifiedAt ? { lastVerifiedAt: pack.lastVerifiedAt.toISOString().slice(0, 10) } : {}),
      requirements: pack.requirements.map((requirement) => ({
        id: requirement.id,
        title: requirement.title,
        ...(requirement.description ? { description: requirement.description } : {}),
        required: requirement.required,
        ...(requirement.group ? { group: requirement.group } : {}),
        ...(requirement.owner !== "self" ? { owner: requirement.owner } : {}),
        acceptedDocumentTypes: [...new Set(requirement.acceptedDocumentTypes.map((type) => normalizeDocumentType(type)))],
        ...(requirement.metadata && typeof requirement.metadata === "object" && Object.keys(requirement.metadata as object).length ? { metadata: requirement.metadata } : {}),
        ...assignmentPayload(assignments, requirement.id),
      })),
    })),
    matches,
    hasConfidentMatch: matches.length > 0,
    canGenerate: Boolean(query?.trim()) && matches.length === 0,
    categories,
    pagination: {
      page,
      limit,
      total,
      hasNextPage: page * limit < total,
    },
  };
}

function listSearchMetadata(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const metadata = value as Record<string, unknown>;
  const uiAccent = typeof metadata.uiAccent === "string" ? metadata.uiAccent : undefined;
  const uiIcon = typeof metadata.uiIcon === "string" ? metadata.uiIcon : undefined;
  return uiAccent || uiIcon ? { ...(uiAccent ? { uiAccent } : {}), ...(uiIcon ? { uiIcon } : {}) } : null;
}
function isConfidentSearchScore(score: PackScore | undefined) {
  if (!score) return false;
  if (score.score >= 70 && score.missingTokens.length === 0) return true;
  return score.missingTokens.length === 0 && score.matchedTokens.length > 0 && score.score >= 20;
}

function packageCategoryMatches(packCategory: string, selectedCategory: string) {
  if (selectedCategory === "All") return true;
  return packCategory.trim().toLowerCase() === selectedCategory.trim().toLowerCase();
}

async function uniqueUserPackSlug(userId: string, title: string) {
  const base = `custom-${slugify(userId).slice(0, 12)}-${slugify(title) || "pack"}`;
  let slug = base;
  for (let index = 2; await prisma.readinessPack.findUnique({ where: { slug }, select: { id: true } }); index += 1) {
    slug = `${base}-${index}`;
  }
  return slug;
}

function cleanRequirementTitles(requirements: string[]) {
  return [...new Set(requirements.map((item) => item.trim()).filter(Boolean))].slice(0, 40);
}

function customPackKeywords(title: string, description: string, requirements: string[]) {
  return [...new Set([title, description, ...requirements].flatMap((item) => item.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean))];
}

function customPackMetadata(metadata: Record<string, unknown> | undefined) {
  return {
    ...(metadata ?? {}),
    custom: true,
    uiAccent: "gold",
    uiIcon: "FileText",
  };
}

function customRequirement(packSlug: string, title: string, index: number) {
  const acceptedDocumentTypes = normalizeRequirementDocumentTypes(title, title);
  return {
    id: `${packSlug}:custom:${index}:${slugify(title) || "document"}`,
    title,
    documentType: acceptedDocumentTypes[0] ?? "unknown",
    owner: "self",
    description: title,
    metadata: { custom: true },
    required: true,
    group: "Required",
    acceptedDocumentTypes,
    alternativeLabels: [title],
    sortOrder: index,
  };
}

function parseOptionalDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
