/* eslint-disable max-lines */
import { prisma } from "../lib/prisma";
import { normalizeDocumentType, slugify } from "./readiness/normalization";
import { readinessPackSeeds } from "./readiness/readinessPackData";
import { seedReadinessPacks } from "./readiness/readiness.service";
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

export async function ensureReadinessPacks() {
  const [count, sourcedCount, passportApplicationPack] = await Promise.all([
    prisma.readinessPack.count({ where: { createdBy: "seed" } }),
    prisma.readinessPack.count({
      where: {
        createdBy: "seed",
        sourceTitle: { not: null },
        sourceUrl: { not: null },
        lastCheckedAt: { not: null },
      },
    }),
    prisma.readinessPack.findUnique({
      where: { slug: "passport-application-pack" },
      select: { id: true, searchMetadata: true },
    }),
  ]);

  if (count !== readinessPackSeeds.length || sourcedCount !== readinessPackSeeds.length || !passportApplicationPack?.searchMetadata) {
    await seedReadinessPacks();
  }
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

export async function listPackageSummaries(options: PackageListOptions) {
  await ensureReadinessPacks();
  const page = Math.max(1, options.page);
  const limit = Math.min(Math.max(1, options.limit), 200);
  const filters = [options.search, options.provider, options.location]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const hasCategoryFilter = Boolean(options.category?.trim() && options.category !== "All");
  const where = {};
  const select = {
    id: true,
    slug: true,
    title: true,
    category: true,
    aliases: true,
    description: true,
    keywords: true,
    searchMetadata: true,
    sourceName: true,
    sourceTitle: true,
    sourceUrl: true,
    lastCheckedAt: true,
    createdAt: true,
    requirements: {
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

  if (!filters.length && !hasCategoryFilter && options.sort !== "relevance") {
    const [total, packs] = await Promise.all([
      prisma.readinessPack.count({ where }),
      prisma.readinessPack.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return toPaginatedPackageResponse(packs, total, page, limit, options.search);
  }

  const packs = await prisma.readinessPack.findMany({ where, select, orderBy });
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
  return toPaginatedPackageResponse(
    filtered.slice((page - 1) * limit, page * limit).map(({ pack }) => pack),
    filtered.length,
    page,
    limit,
    options.search,
    new Map(filtered.map(({ pack, scoreDetail }) => [pack.slug, scoreDetail]).filter((entry): entry is [string, PackScore] => Boolean(entry[1]))),
  );
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

export async function getReadinessPackDefinitionByCanonicalSlug(slug: string) {
  await ensureReadinessPacks();
  return prisma.readinessPack.findUnique({
    where: { slug: slugify(slug) },
    select: packDefinitionSelect,
  });
}

function toPaginatedPackageResponse<T extends {
  createdAt: Date;
  id: string;
  slug: string;
  title: string;
  category: string;
  aliases: string[];
  keywords: string[];
  searchMetadata: unknown;
  description: string;
  sourceName: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  lastCheckedAt: Date | null;
  requirements: Array<{
    id: string;
    title: string;
    description: string;
    required: boolean;
    group: string;
    owner: string;
    metadata: unknown;
    acceptedDocumentTypes: string[];
  }>;
}>(packs: T[], total: number, page: number, limit: number, query?: string, matchInfo = new Map<string, PackScore>()) {
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
      category: pack.category,
      description: pack.description,
      ...(pack.sourceName || pack.sourceTitle || pack.sourceUrl || pack.lastCheckedAt ? { source: {
        ...(pack.sourceName ? { name: pack.sourceName } : {}),
        ...(pack.sourceTitle ? { title: pack.sourceTitle } : {}),
        ...(pack.sourceUrl ? { url: pack.sourceUrl } : {}),
        ...(pack.lastCheckedAt ? { lastCheckedAt: pack.lastCheckedAt.toISOString().slice(0, 10) } : {}),
      } } : {}),
      requirements: pack.requirements.map((requirement) => ({
        id: requirement.id,
        title: requirement.title,
        ...(requirement.description ? { description: requirement.description } : {}),
        required: requirement.required,
        ...(requirement.group ? { group: requirement.group } : {}),
        ...(requirement.owner !== "self" ? { owner: requirement.owner } : {}),
        acceptedDocumentTypes: [...new Set(requirement.acceptedDocumentTypes.map((type) => normalizeDocumentType(type)))],
        ...(requirement.metadata && typeof requirement.metadata === "object" && Object.keys(requirement.metadata as object).length ? { metadata: requirement.metadata } : {}),
      })),
    })),
    matches,
    hasConfidentMatch: matches.length > 0,
    canGenerate: Boolean(query?.trim()) && matches.length === 0,
    pagination: {
      page,
      limit,
      total,
      hasNextPage: page * limit < total,
    },
  };
}
function isConfidentSearchScore(score: PackScore | undefined) {
  if (!score) return false;
  if (score.score >= 70 && score.missingTokens.length === 0) return true;
  return score.missingTokens.length === 0 && score.matchedTokens.length > 0 && score.score >= 20;
}

function packageCategoryMatches(packCategory: string, selectedCategory: string) {
  if (selectedCategory === "All") return true;
  const category = packCategory.toLowerCase();
  const terms: Record<string, string[]> = {
    "Travel & Immigration": ["travel", "visa", "immigration"],
    "Identity & Civic": ["identity", "civic", "government"],
    "Money & Tax": ["banking", "finance", "money", "tax", "loan"],
    "Jobs & Employment": ["job", "employment", "business"],
    Education: ["education", "school", "student"],
    Health: ["health", "medical", "insurance"],
    "Home & Property": ["home", "property", "housing"],
    "Family & Life": ["family", "life"],
  };
  return (terms[selectedCategory] ?? [selectedCategory.toLowerCase()]).some((term) => category.includes(term));
}
