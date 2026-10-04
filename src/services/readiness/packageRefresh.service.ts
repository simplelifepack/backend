import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { researchPackageRefresh, PackageRefreshError } from "../../ai/researchPackageRefresh";
import { getReadinessPackDefinitionBySlugForUser } from "../packs.service";
import { jsonObject, planPackageRefresh } from "./packageRefreshPlan";
import { assertAIProcessingEnabled } from "../aiProcessing.service";

const inFlight = new Map<string, Promise<Awaited<ReturnType<typeof refreshPackage>>>>();

export async function refreshPackageForUser(userId: string, slug: string, research = researchPackageRefresh) {
  await assertAIProcessingEnabled(userId);
  // Exact lookup: refresh must never choose a fuzzy catalogue match.
  const pack = await prisma.readinessPack.findUnique({ where: { slug }, include: { requirements: { orderBy: { sortOrder: "asc" } } } });
  if (!pack || (!["seed", "ai"].includes(pack.createdBy) && pack.createdBy !== userId)) throw new PackageRefreshError("Package not found.", 404);
  let job = inFlight.get(pack.id);
  if (!job) {
    job = refreshPackage(userId, pack, research).finally(() => inFlight.delete(pack.id));
    inFlight.set(pack.id, job);
  }
  const result = await job;
  const latest = await getReadinessPackDefinitionBySlugForUser(slug, userId);
  if (!latest) throw new PackageRefreshError("Package no longer available.", 404);
  return {
    ...result,
    package: { ...latest, source: { name: latest.sourceName, title: latest.sourceTitle, url: latest.sourceUrl, lastCheckedAt: latest.lastCheckedAt?.toISOString() } },
  };
}

async function refreshPackage(userId: string, pack: NonNullable<Awaited<ReturnType<typeof prisma.readinessPack.findUnique>>> & { requirements: Awaited<ReturnType<typeof prisma.requirement.findMany>> }, research: typeof researchPackageRefresh) {
  const signal = AbortSignal.timeout(180_000);
  const { checklist, sources } = await research(userId, pack, signal);
  signal.throwIfAborted();
  const plan = planPackageRefresh(pack, checklist, sources);
  const now = new Date();
  await prisma.$transaction(async tx => {
    // Optimistic lock: do not overwrite edits or another server's newer refresh.
    const locked = await tx.readinessPack.updateMany({ where: { id: pack.id, updatedAt: pack.updatedAt }, data: {
      ...(plan.changed ? { ...plan.data, searchMetadata: plan.data.searchMetadata as Prisma.InputJsonValue, verificationSources: plan.data.verificationSources as Prisma.InputJsonValue, version: { increment: 1 } } : {}),
      lastCheckedAt: now, lastVerifiedAt: now,
    } });
    if (locked.count !== 1) throw new PackageRefreshError("The package changed while being checked. Please refresh again.", 409);
    for (const item of plan.requirements.filter(item => item.changed)) {
      const data = { ...item.data, metadata: item.data.metadata as Prisma.InputJsonValue };
      if (item.id) await tx.requirement.update({ where: { id: item.id }, data });
      else await tx.requirement.create({ data: { ...data, packId: pack.id } });
    }
    // Keep obsolete rows and their user assignments for audit/recovery, out of runtime checklists.
    for (const item of plan.retired) await tx.requirement.update({ where: { id: item.id }, data: { metadata: { ...jsonObject(item.metadata), refreshRetired: true } as Prisma.InputJsonValue } });
  });
  return { changed: plan.changed, message: plan.changed ? "Updated with the latest requirements" : "Checked — no changes found" };
}
