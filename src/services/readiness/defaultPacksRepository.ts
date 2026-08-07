import type { AIReadinessPackage } from "../../ai/intentTypes";
import { prisma } from "../../lib/prisma";
import { normalizeRequirementDocumentTypes, normalizeSearchText, slugify } from "./normalization";
import { scorePackDetailed, type PackMatchReason } from "./readinessScoring";

const CONFIDENT_MATCH_SCORE = 70;

export type DefaultPackSearchMatch = {
  slug: string;
  confidence: number;
  reason: PackMatchReason;
  hasOfficialSource: boolean;
};

export async function findDefaultPackSlug(query: string) {
  return (await findDefaultPackMatch(query))?.slug ?? null;
}

export async function findDefaultPackMatch(query: string): Promise<DefaultPackSearchMatch | null> {
  const packages = await prisma.readinessPack.findMany({
    select: {
      slug: true,
      title: true,
      aliases: true,
      category: true,
      description: true,
      keywords: true,
      sourceTitle: true,
      sourceUrl: true,
      lastCheckedAt: true,
      verificationSources: true,
    },
  });
  const [best] = packages
    .map((item) => {
      const score = scorePackDetailed(item, query);
      return {
        slug: item.slug,
        confidence: score.score,
        reason: score.reason,
        hasOfficialSource: hasOfficialSource(item),
      };
    })
    .filter((item): item is DefaultPackSearchMatch => item.reason !== null && item.confidence >= CONFIDENT_MATCH_SCORE)
    .sort((left, right) => right.confidence - left.confidence || left.slug.localeCompare(right.slug));
  return best ?? null;
}

export async function saveGeneratedDefaultPack(query: string, generated: AIReadinessPackage) {
  const duplicate = await findDefaultPackMatch(`${query} ${generated.packageName}`);
  if (duplicate) {
    await addSearchMetadata(duplicate.slug, query, generated);
    return duplicate.slug;
  }

  const slug = slugify(generated.packageName);
  const alias = normalizeSearchText(query);
  const keywords = searchKeywords(query, generated);
  const verification = verificationMetadata(generated);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.readinessPack.findUnique({ where: { slug }, select: { slug: true, aliases: true, keywords: true, createdBy: true, verificationSources: true } });
    if (existing) {
      await tx.readinessPack.update({
        where: { slug },
        data: {
          aliases: [...new Set([...existing.aliases, alias])],
          keywords: [...new Set([...existing.keywords, ...keywords])],
          ...(!hasVerificationSources(existing.verificationSources) ? verification : {}),
        },
      });
      return slug;
    }
    await tx.readinessPack.create({
      data: {
        slug,
        title: generated.packageName,
        category: generated.category,
        description: generated.description,
        aliases: [alias],
        keywords,
        sourceType: "official",
        sourceName: verification.sourceName,
        sourceTitle: verification.sourceTitle,
        sourceUrl: verification.sourceUrl,
        lastCheckedAt: verification.lastCheckedAt,
        verificationSources: verification.verificationSources,
        lastVerifiedAt: verification.lastVerifiedAt,
        verificationStatus: verification.verificationStatus,
        createdBy: "ai",
        version: 1,
        requirements: {
          create: generated.requiredDocuments.map((requirement, index) => ({
            id: `${slug}:${requirement.id}`,
            title: requirement.title,
            documentType: normalizeRequirementDocumentTypes(requirement.documentType, requirement.title)[0]!,
            owner: requirement.owner,
            description: `${requirement.title} required for ${generated.packageName}.`,
            required: requirement.required,
            group: requirement.category,
            acceptedDocumentTypes: normalizeRequirementDocumentTypes(requirement.documentType, requirement.title),
            alternativeLabels: [],
            sortOrder: index,
          })),
        },
      },
      select: { slug: true },
    });
    return slug;
  });
}

async function addSearchMetadata(slug: string, query: string, generated: AIReadinessPackage) {
  const alias = normalizeSearchText(query);
  const keywords = searchKeywords(query, generated);
  const verification = verificationMetadata(generated);
  const existing = await prisma.readinessPack.findUnique({
    where: { slug },
    select: { aliases: true, keywords: true, createdBy: true, verificationSources: true },
  });
  if (!existing) return;
  await prisma.readinessPack.update({
    where: { slug },
    data: {
      aliases: [...new Set([...existing.aliases, alias])],
      keywords: [...new Set([...existing.keywords, ...keywords])],
      ...(!hasVerificationSources(existing.verificationSources) ? verification : {}),
    },
  });
}

function verificationMetadata(generated: AIReadinessPackage) {
  if (!generated.sourceTitle || !generated.sourceUrl || !generated.sourceOrganization || !generated.lastChecked) {
    throw new Error("Generated package is missing official source metadata.");
  }
  const lastVerifiedAt = new Date(generated.lastChecked);
  if (Number.isNaN(lastVerifiedAt.getTime())) {
    throw new Error("Generated package has an invalid source checked date.");
  }
  return {
    sourceName: generated.sourceOrganization,
    sourceTitle: generated.sourceTitle,
    sourceUrl: generated.sourceUrl,
    lastCheckedAt: lastVerifiedAt,
    verificationSources: generated.verificationSources.length
      ? generated.verificationSources
      : [{
        title: generated.sourceTitle,
        organization: generated.sourceOrganization,
        url: generated.sourceUrl,
        type: "official" as const,
        retrievedAt: generated.lastChecked,
      }],
    lastVerifiedAt,
    verificationStatus: "verified",
  };
}

function hasVerificationSources(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function hasOfficialSource(pack: {
  lastCheckedAt: Date | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  verificationSources: unknown;
}) {
  return Boolean(pack.sourceTitle && pack.sourceUrl && pack.lastCheckedAt && hasVerificationSources(pack.verificationSources));
}

function searchKeywords(query: string, generated: AIReadinessPackage) {
  return [...new Set(tokens(`${query} ${generated.packageName} ${generated.category} ${generated.description} ${generated.requiredDocuments.map((document) => `${document.title} ${document.name} ${document.category} ${document.documentType}`).join(" ")}`))];
}

function tokens(value: string) {
  return normalizeSearchText(value).split(" ").filter((token) => token.length > 2);
}
