import { prisma } from "../../lib/prisma";
import { activeRequirementsWhere } from "./activeRequirements";
import { scorePack } from "./readinessScoring";
import type { PackWithRequirements } from "./readinessModels";

export async function searchReadinessPacks(query: string, limit = 5) {
  const packs: PackWithRequirements[] = await prisma.readinessPack.findMany({
    include: { requirements: { where: activeRequirementsWhere, orderBy: { sortOrder: "asc" } } },
    orderBy: { title: "asc" },
  });
  return packs.map((pack) => ({ pack, score: scorePack(pack, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.pack.title.localeCompare(right.pack.title))
    .slice(0, limit)
    .map(({ pack }) => ({ id: pack.id, title: pack.title, slug: pack.slug, category: pack.category, description: pack.description }));
}
