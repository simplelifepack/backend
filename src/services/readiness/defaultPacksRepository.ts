import type { AIReadinessPackage } from "../../ai/intentTypes";
import { prisma } from "../../lib/prisma";
import { normalizeRequirementDocumentTypes, normalizeSearchText, slugify } from "./normalization";

export async function findDefaultPackSlug(query: string) {
  const normalized = normalizeSearchText(query);
  const querySlug = slugify(query);
  const queryTokens = tokens(normalized);
  const packages = await prisma.readinessPack.findMany({
    select: { slug: true, title: true, aliases: true, keywords: true },
  });
  const exact = packages.find((item) => item.slug === querySlug || normalizeSearchText(item.title) === normalized || item.aliases.some((alias) => normalizeSearchText(alias) === normalized));
  if (exact) return exact.slug;
  const keywordMatch = packages.find((item) => queryTokens.length >= 2 && queryTokens.every((token) => item.keywords.includes(token)));
  return keywordMatch?.slug ?? null;
}

export async function saveGeneratedDefaultPack(query: string, generated: AIReadinessPackage) {
  const slug = slugify(generated.packageName);
  const alias = normalizeSearchText(query);
  const keywords = [...new Set(tokens(`${query} ${generated.packageName} ${generated.category}`))];
  return prisma.$transaction(async (tx) => {
    const existing = await tx.readinessPack.findUnique({ where: { slug }, select: { slug: true, aliases: true, keywords: true } });
    if (existing) {
      await tx.readinessPack.update({
        where: { slug },
        data: {
          aliases: [...new Set([...existing.aliases, alias])],
          keywords: [...new Set([...existing.keywords, ...keywords])],
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

function tokens(value: string) {
  return normalizeSearchText(value).split(" ").filter((token) => token.length > 2);
}
