import { prisma } from "../../lib/prisma";
import { readinessPackSeeds } from "./readinessPackData";
import { scorePack } from "./readinessScoring";
import { slugify } from "./normalization";
import type { PackWithRequirements } from "./readinessModels";

export async function seedReadinessPacks() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(824617204)`;
    await tx.readinessPack.deleteMany({ where: { createdBy: "seed" } });
    await tx.readinessPack.createMany({ data: readinessPackSeeds.map((seed) => ({
      slug: seed.slug,
      title: seed.title,
      subtitle: seed.subtitle,
      category: seed.category,
      aliases: seed.aliases,
      description: seed.description,
      keywords: packageKeywords(seed.title, seed.aliases),
      searchMetadata: seed.searchMetadata,
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
    })) });
    const packs = await tx.readinessPack.findMany({ where: { createdBy: "seed" }, select: { id: true, slug: true } });
    const ids = new Map(packs.map((pack) => [pack.slug, pack.id]));
    await tx.requirement.createMany({ data: readinessPackSeeds.flatMap((seed) => seed.requirements.map((requirement, index) => ({
      packId: ids.get(seed.slug)!,
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
    }))) });
  }, { maxWait: 10_000, timeout: 30_000 });
  return { count: readinessPackSeeds.length };
}

export async function searchReadinessPacks(query: string, limit = 5) {
  const packs: PackWithRequirements[] = await prisma.readinessPack.findMany({
    include: { requirements: { orderBy: { sortOrder: "asc" } } },
    orderBy: { title: "asc" },
  });
  return packs.map((pack) => ({ pack, score: scorePack(pack, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.pack.title.localeCompare(right.pack.title))
    .slice(0, limit)
    .map(({ pack }) => ({ id: pack.id, title: pack.title, slug: pack.slug, category: pack.category, description: pack.description }));
}

function packageKeywords(title: string, aliases: string[]) {
  return [...new Set([title, ...aliases].flatMap((value) => slugify(value).split("-")).filter((value) => value.length > 2))];
}
