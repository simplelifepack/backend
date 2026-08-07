/* eslint-disable max-lines */
import { prisma } from "../lib/prisma";
import { normalizeDocumentType, slugify } from "./readiness/normalization";
import { readinessPackSeeds } from "./readiness/readinessPackData";
import { seedReadinessPacks } from "./readiness/readiness.service";
import { decryptJson } from "../utils/documentEncryption";
import { buildDocumentMetadata, normalizeDocumentOwner } from "./readiness/documentMetadata";
import { matchRequirementMetadata } from "./readiness/metadataMatcher";
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
      select: { id: true },
    }),
  ]);

  if (count !== readinessPackSeeds.length || sourcedCount !== readinessPackSeeds.length || !passportApplicationPack) {
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
  const limit = Math.min(Math.max(1, options.limit), 50);
  const filters = [options.search, options.provider, options.location]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const hasCategoryFilter = Boolean(options.category?.trim() && options.category !== "All");
  const where = {};
  const select = {
    id: true,
    slug: true,
    title: true,
    subtitle: true,
    category: true,
    aliases: true,
    description: true,
    keywords: true,
    sourceType: true,
    sourceName: true,
    sourceTitle: true,
    sourceUrl: true,
    lastCheckedAt: true,
    verificationSources: true,
    lastVerifiedAt: true,
    verificationStatus: true,
    createdBy: true,
    version: true,
    createdAt: true,
    _count: {
      select: {
        requirements: { where: { required: true } },
      },
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

function normalizedTypeForDocument(document: { documentType: string; normalizedType: string | null }) {
  return document.normalizedType ?? normalizeDocumentType(document.documentType);
}

export async function getPackSummaries(userId?: string) {
  await ensureReadinessPacks();

  const [packs, documents] = await Promise.all([
    prisma.readinessPack.findMany({
      include: {
        requirements: {
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ category: "asc" }, { title: "asc" }],
    }),
    prisma.document.findMany({
      where: userId ? {
        ownerProfileId: userId,
        targetProfileId: userId,
        readinessEligible: true,
        classificationStatus: "verified",
        ownershipStatus: "verified",
        integrityStatus: "passed",
        deletedAt: null,
      } : {
        readinessEligible: true,
        classificationStatus: "verified",
        ownershipStatus: "verified",
        integrityStatus: "passed",
        deletedAt: null,
      },
      select: {
        id: true,
        originalName: true,
        documentType: true,
        normalizedType: true,
        confidence: true,
        createdAt: true,
        fields: true,
      },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const documentMetadata = documents.map((document) => buildDocumentMetadata({
    ...document,
    fields: decryptJson<Record<string, unknown>>(document.fields, {}),
  }, userId ? "self" : undefined));

  return packs.map((pack) => {
    const requiredSlots = pack.requirements.filter((requirement) => requirement.required);
    const matchedRequired = requiredSlots.filter((requirement) => matchRequirementMetadata({
      id: requirement.id,
      title: requirement.title,
      documentType: normalizeDocumentType(requirement.documentType),
      acceptedDocumentTypes: requirement.acceptedDocumentTypes.map((type) => normalizeDocumentType(type)),
      owner: normalizeDocumentOwner(requirement.owner),
      category: requirement.group,
      required: requirement.required,
      constraints: requirement.metadata && typeof requirement.metadata === "object" ? requirement.metadata as Record<string, string | number | boolean | null> : undefined,
    }, documentMetadata).state === "ready");
    const missingRequired = requiredSlots.filter((requirement) => !matchedRequired.includes(requirement));
    const completion = requiredSlots.length ? Math.round((matchedRequired.length / requiredSlots.length) * 100) : 0;

    return {
      id: pack.id,
      slug: pack.slug,
      name: pack.title,
      title: pack.title,
      category: pack.category,
      description: pack.description,
      requiredDocumentTypes: requiredSlots.map((requirement) => requirement.title),
      uploadedDocumentTypes: matchedRequired.map((requirement) => requirement.title),
      missingDocumentTypes: missingRequired.map((requirement) => requirement.title),
      completion,
    };
  });
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
  _count?: { requirements: number };
  createdAt: Date;
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  category: string;
  description: string;
  sourceType: string;
  sourceName: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  lastCheckedAt: Date | null;
  verificationSources: unknown;
  lastVerifiedAt: Date | null;
  verificationStatus: string;
  createdBy: string;
  version: number;
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
      name: pack.title,
      title: pack.title,
      subtitle: pack.subtitle,
      category: pack.category,
      provider: null,
      location: null,
      description: pack.description,
      shortDescription: pack.subtitle ?? pack.description,
      icon: null,
      sourceType: pack.sourceType,
      sourceName: pack.sourceName,
      sourceTitle: pack.sourceTitle,
      sourceUrl: pack.sourceUrl,
      lastCheckedAt: pack.lastCheckedAt?.toISOString() ?? null,
      verificationSources: normalizeVerificationSources(pack.verificationSources),
      lastVerifiedAt: pack.lastVerifiedAt?.toISOString() ?? null,
      verificationStatus: pack.verificationStatus,
      createdAt: pack.createdAt.toISOString(),
      requiredDocumentCount: pack._count?.requirements ?? 0,
      readyDocumentCount: 0,
      source: pack.sourceType,
      generationSource: pack.createdBy,
      version: pack.version,
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

type VerificationSourceSummary = {
  title: string;
  organization: string;
  url: string;
  type: "government" | "official" | "bank" | "university" | "insurance" | "authority";
  retrievedAt: string;
};

function normalizeVerificationSources(value: unknown): VerificationSourceSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    if (typeof source.title !== "string" || typeof source.organization !== "string" || typeof source.url !== "string") return [];
    const retrievedAt = typeof source.retrievedAt === "string" && !Number.isNaN(Date.parse(source.retrievedAt))
      ? new Date(source.retrievedAt).toISOString()
      : new Date().toISOString();
    return [{
      title: source.title,
      organization: source.organization,
      url: source.url,
      type: isVerificationSourceType(source.type) ? source.type : "official",
      retrievedAt,
    }];
  });
}

function isVerificationSourceType(value: unknown): value is VerificationSourceSummary["type"] {
  return typeof value === "string" && ["government", "official", "bank", "university", "insurance", "authority"].includes(value);
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
