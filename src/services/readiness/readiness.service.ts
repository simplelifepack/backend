/* eslint-disable max-lines */
import { prisma } from "../../lib/prisma";
import { decryptString } from "../../utils/documentEncryption";
import { decryptJson } from "../../utils/documentEncryption";
import type { ReadinessRequirementMetadata } from "./metadataTypes";
import { buildDocumentMetadata, normalizeDocumentOwner } from "./documentMetadata";
import { matchRequirementMetadata } from "./metadataMatcher";
import { normalizeDocumentType, slugify } from "./normalization";
import { readinessPackSeeds } from "./readinessPackData";
import { scorePack } from "./readinessScoring";
import type { DocumentForReadiness, PackWithRequirements, RequirementWithPack } from "./readinessModels";
async function ensureSeeded() {
  const [count, sourcedCount, passportApplicationPack, photographRequirement] = await Promise.all([
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
    prisma.requirement.findFirst({
      where: { title: "Photograph" },
      select: { acceptedDocumentTypes: true, documentType: true },
    }),
  ]);
  const hasFreshPhotoRequirement =
    photographRequirement?.acceptedDocumentTypes.includes("passport_photo") &&
    photographRequirement.acceptedDocumentTypes.includes("photo") &&
    photographRequirement.documentType !== "unknown";
  if (count !== readinessPackSeeds.length || sourcedCount !== readinessPackSeeds.length || !passportApplicationPack || !hasFreshPhotoRequirement) {
    await seedReadinessPacks();
  }
}
export async function seedReadinessPacks() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(824617204)`;
    await tx.readinessPack.deleteMany({ where: { createdBy: "seed" } });
    await tx.readinessPack.createMany({
      data: readinessPackSeeds.map((seed) => ({
        slug: seed.slug,
        title: seed.title,
        subtitle: seed.subtitle,
        category: seed.category,
        aliases: seed.aliases,
        description: seed.description,
        keywords: packageKeywords(seed.title, seed.aliases),
        sourceType: seed.sourceType ?? "curated",
        sourceName: seed.sourceName,
        sourceTitle: seed.sourceTitle,
        sourceUrl: seed.sourceUrl,
        lastCheckedAt: seed.lastCheckedAt,
        verificationSources: seed.verificationSources,
        lastVerifiedAt: seed.lastVerifiedAt,
        verificationStatus: seed.verificationStatus ?? (seed.verificationSources?.length ? "verified" : "needs_review"),
        createdBy: "seed",
        version: 1,
      })),
    });

    const packs = await tx.readinessPack.findMany({
      where: { createdBy: "seed" },
      select: { id: true, slug: true },
    });
    const packIds = new Map(packs.map((pack) => [pack.slug, pack.id]));
    await tx.requirement.createMany({
      data: readinessPackSeeds.flatMap((seed) => {
        const packId = packIds.get(seed.slug);
        if (!packId) throw new Error(`Seeded readiness pack was not found: ${seed.slug}`);
        return seed.requirements.map((requirement, index) => ({
          packId,
          title: requirement.title,
          documentType: requirement.documentType,
          owner: requirement.owner,
          metadata: requirement.metadata,
          description: requirement.description,
          required: requirement.required,
          group: requirement.group,
          acceptedDocumentTypes: requirement.acceptedDocumentTypes,
          alternativeLabels: requirement.alternativeLabels,
          sortOrder: index,
        }));
      }),
    });
  }, {
    maxWait: 10_000,
    timeout: 30_000,
  });
  return { count: readinessPackSeeds.length };
}
async function listPacksWithRequirements(): Promise<PackWithRequirements[]> {
  await ensureSeeded();
  return prisma.readinessPack.findMany({
    include: {
      requirements: {
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { title: "asc" },
  });
}
export async function searchReadinessPacks(query: string, limit = 5) {
  const packs = await listPacksWithRequirements();
  return rankReadinessPacks(packs, query, limit);
}
function rankReadinessPacks(packs: PackWithRequirements[], query: string, limit: number) {
  return packs
    .map((pack) => ({ pack, score: scorePack(pack, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.pack.title.localeCompare(right.pack.title))
    .slice(0, limit)
    .map(({ pack }) => ({
      id: pack.id,
      title: pack.title,
      slug: pack.slug,
      category: pack.category,
      description: pack.description,
    }));
}
function findBestPack(packs: PackWithRequirements[], queryOrSlug: string) {
  const exactSlug = slugify(queryOrSlug);
  const slugMatch = packs.find((pack) => pack.slug === exactSlug);
  if (slugMatch) return { pack: slugMatch, score: 150 };
  const [best] = packs
    .map((pack) => ({ pack, score: scorePack(pack, queryOrSlug) }))
    .sort((left, right) => right.score - left.score || left.pack.title.localeCompare(right.pack.title));
  return best && best.score >= 28 ? best : null;
}
function slotKey(requirement: RequirementWithPack) {
  return requirement.id;
}
function decryptReadinessDocument<T extends { originalName: string; uniqueIdentifier: string | null; fields: unknown }>(document: T): T {
  return {
    ...document,
    originalName: decryptString(document.originalName) ?? "document",
    uniqueIdentifier: decryptString(document.uniqueIdentifier),
    fields: decryptJson<Record<string, unknown>>(document.fields, {}),
  };
}
function compareDocumentQuality(left: DocumentForReadiness, right: DocumentForReadiness) {
  return right.confidence - left.confidence || right.createdAt.getTime() - left.createdAt.getTime();
}
function toMatchedDocument(document: DocumentForReadiness, fallbackDisplayName: string) {
  const metadata = buildDocumentMetadata(document);
  return {
    id: document.id,
    originalName: document.originalName,
    displayName: document.displayName ?? fallbackDisplayName,
    uniqueIdentifier: document.uniqueIdentifier,
    normalizedType: metadata.documentType,
    owner: metadata.owner,
    confidence: document.confidence,
  };
}
export async function getReadinessForQuery(userId: string | undefined, query: string) {
  const packs = await listPacksWithRequirements();
  return buildReadinessResult(userId, query, packs);
}
async function buildReadinessResult(
  userId: string | undefined,
  query: string,
  packs: PackWithRequirements[],
) {
  const best = findBestPack(packs, query);
  const suggestions = rankReadinessPacks(packs, query, 3);
  if (!best) {
    return {
      query,
      matchedPack: null,
      readiness: {
        totalRequired: 0,
        satisfiedRequired: 0,
        missingRequired: 0,
        percentage: 0,
      },
      groups: [],
      missing: [],
      suggestions,
    };
  }
  const encryptedDocuments = await prisma.document.findMany({
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
      mimeType: true,
      path: true,
      documentType: true,
      normalizedType: true,
      displayName: true,
      uniqueIdentifier: true,
      confidence: true,
      createdAt: true,
      fields: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const documents = encryptedDocuments.map(decryptReadinessDocument);
  const documentMetadata = documents.map((document) =>
    buildDocumentMetadata(document, userId ? "self" : undefined));
  const rows = best.pack.requirements.map((requirement) => {
    const requirementMetadata: ReadinessRequirementMetadata = {
      id: requirement.id,
      title: requirement.title,
      documentType: normalizeDocumentType(requirement.documentType),
      acceptedDocumentTypes: requirement.acceptedDocumentTypes.map((type) => normalizeDocumentType(type)),
      owner: normalizeDocumentOwner(requirement.owner),
      category: requirement.group,
      required: requirement.required,
      constraints: requirement.metadata && typeof requirement.metadata === "object" ? requirement.metadata as Record<string, string | number | boolean | null> : undefined,
    };
    const match = matchRequirementMetadata(requirementMetadata, documentMetadata);
    const relatedIds = new Set(match.relatedDocuments.map((document) => document.documentId));
    const readyId = match.document?.documentId;
    const matchedDocuments = documents.filter((document) => document.id === readyId).map((document) => toMatchedDocument(document, requirement.title));
    const alternatives = documents.filter((document) => relatedIds.has(document.id) && document.id !== readyId).sort(compareDocumentQuality).map((document) => toMatchedDocument(document, requirement.title));
    return {
      id: requirement.id,
      key: slotKey(requirement),
      label: requirement.title,
      title: requirement.title,
      description: requirement.description,
      required: requirement.required,
      documentType: requirementMetadata.documentType,
      owner: requirementMetadata.owner,
      status: match.state,
      reason: match.reason,
      matchedDocument: matchedDocuments[0] ?? null,
      matchedDocuments,
      alternatives,
      acceptedDocumentTypes: requirement.acceptedDocumentTypes,
      alternativeLabels: requirement.alternativeLabels,
      group: requirement.group,
    };
  });
  const totalRequired = rows.filter((row) => row.required).length;
  const satisfiedRequired = rows.filter((row) => row.required && row.status === "ready").length;
  const missing = rows.filter((row) => row.required && row.status !== "ready");
  const percentage = totalRequired ? Math.round((satisfiedRequired / totalRequired) * 100) : 0;
  const groups = [...new Set(rows.map((row) => row.group))].map((group) => ({
    group,
    requirements: rows.filter((row) => row.group === group).map(({ group: _group, ...row }) => row),
  }));
  return {
    query,
    matchedPack: {
      id: best.pack.id,
      slug: best.pack.slug,
      title: best.pack.title,
      category: best.pack.category,
      description: best.pack.description,
      requiredSlots: rows.filter((row) => row.required).map(({ group: _group, ...row }) => row),
      optionalSlots: rows.filter((row) => !row.required).map(({ group: _group, ...row }) => row),
    },
    readiness: {
      totalRequired,
      satisfiedRequired,
      missingRequired: totalRequired - satisfiedRequired,
      percentage,
    },
    groups,
    missing: missing.map(({ group: _group, ...row }) => row),
    suggestions: suggestions.filter((suggestion) => suggestion.slug !== best.pack.slug),
  };
}
export async function getReadinessForSlug(userId: string | undefined, slug: string) {
  await ensureSeeded();
  const pack = await prisma.readinessPack.findUnique({
    where: { slug: slugify(slug) },
    include: {
      requirements: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!pack) return getReadinessForQuery(userId, slug);
  return buildReadinessResult(userId, slug, [pack]);
}

function packageKeywords(title: string, aliases: string[]) {
  return [...new Set([title, ...aliases].flatMap((value) => slugify(value).split("-")).filter((value) => value.length > 2))];
}
