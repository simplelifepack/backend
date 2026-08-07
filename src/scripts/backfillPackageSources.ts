import { Prisma } from "@prisma/client";
import { analyzeIntent } from "../ai/analyzeIntent";
import type { AIReadinessPackage } from "../ai/intentTypes";
import { prisma } from "../lib/prisma";
import { normalizeSearchText, slugify } from "../services/readiness/normalization";
import { sourceMetadataForExactPackage, sourceMetadataForSeed } from "../services/readiness/readinessPackSources";

const DEFAULT_BATCH_SIZE = 10;

type SourceMetadata = {
  sourceName: string;
  sourceTitle: string;
  sourceUrl: string;
  lastCheckedAt: Date;
  verificationSources: AIReadinessPackage["verificationSources"];
  lastVerifiedAt: Date;
  verificationStatus: "verified";
};

type PackageForBackfill = {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  sourceName: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  lastCheckedAt: Date | null;
  verificationSources: unknown;
  lastVerifiedAt: Date | null;
  verificationStatus: string;
  createdBy: string;
  requirements: Array<{
    id: string;
    title: string;
    description: string;
    documentType: string;
    owner: string;
    required: boolean;
    group: string;
    acceptedDocumentTypes: string[];
  }>;
};

async function main() {
  const options = readOptions();
  const sourceCache = new Map<string, SourceMetadata | null>();
  const summary = { dryRun: !options.apply, scanned: 0, updated: 0, skipped: 0, failed: 0 };
  let cursor: string | undefined;

  while (summary.scanned < options.limit) {
    const packs = await findMissingSourcePackages(Math.min(options.batchSize, options.limit - summary.scanned), cursor);
    if (!packs.length) break;
    cursor = packs[packs.length - 1]?.id;
    summary.scanned += packs.length;

    for (const pack of packs) {
      const cacheKey = cacheKeyForPack(pack);
      try {
        const metadata = sourceCache.has(cacheKey)
          ? sourceCache.get(cacheKey)!
          : await resolveSourceMetadata(pack, options.useAi);
        sourceCache.set(cacheKey, metadata);

        if (!metadata) {
          summary.skipped += 1;
          log("skipped", pack, { reason: "official source not found" });
          continue;
        }

        const update = sourceUpdateForPack(pack, metadata);
        if (!Object.keys(update).length) {
          summary.skipped += 1;
          log("skipped", pack, { reason: "source metadata already complete" });
          continue;
        }

        if (options.apply) {
          await prisma.$transaction(async (tx) => {
            await tx.readinessPack.update({
              where: { id: pack.id },
              data: update,
            });
          });
        }

        summary.updated += 1;
        log(options.apply ? "updated" : "dry-run", pack, {
          sourceTitle: metadata.sourceTitle,
          sourceOrganization: metadata.sourceName,
          sourceUrl: metadata.sourceUrl,
          lastChecked: metadata.lastCheckedAt.toISOString(),
          fields: Object.keys(update),
        });
      } catch (error) {
        summary.failed += 1;
        log("failed", pack, {
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }

  console.info("[LifePack Package Source Backfill] complete", summary);
}

async function findMissingSourcePackages(limit: number, cursor?: string) {
  return prisma.readinessPack.findMany({
    where: {
      OR: [
        { sourceName: null },
        { sourceTitle: null },
        { sourceUrl: null },
        { lastCheckedAt: null },
        { verificationSources: { equals: Prisma.DbNull } },
        { verificationStatus: { not: "verified" } },
      ],
    },
    select: {
      id: true,
      slug: true,
      title: true,
      category: true,
      description: true,
      sourceName: true,
      sourceTitle: true,
      sourceUrl: true,
      lastCheckedAt: true,
      verificationSources: true,
      lastVerifiedAt: true,
      verificationStatus: true,
      createdBy: true,
      requirements: {
        select: {
          id: true,
          title: true,
          description: true,
          documentType: true,
          owner: true,
          required: true,
          group: true,
          acceptedDocumentTypes: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ id: "asc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit,
  });
}

async function resolveSourceMetadata(pack: PackageForBackfill, useAi: boolean): Promise<SourceMetadata | null> {
  const exact = sourceMetadataForExactPackage(pack.title);
  if (exact) return metadataFromSeedSource(exact);

  if (pack.createdBy === "seed") {
    const seed = sourceMetadataForSeed(pack.title, pack.category);
    return metadataFromSeedSource(seed);
  }

  if (!useAi) return null;
  const generated = await analyzeIntent(promptForPack(pack));
  return metadataFromGenerated(generated);
}

function metadataFromSeedSource(seed: ReturnType<typeof sourceMetadataForSeed>): SourceMetadata | null {
  if (!seed.sourceName || !seed.sourceTitle || !seed.sourceUrl || !seed.lastCheckedAt) return null;
  return {
    sourceName: seed.sourceName,
    sourceTitle: seed.sourceTitle,
    sourceUrl: seed.sourceUrl,
    lastCheckedAt: seed.lastCheckedAt,
    verificationSources: normalizeVerificationSources(seed.verificationSources, seed.sourceTitle, seed.sourceName, seed.sourceUrl, seed.lastCheckedAt),
    lastVerifiedAt: seed.lastVerifiedAt ?? seed.lastCheckedAt,
    verificationStatus: "verified",
  };
}

function metadataFromGenerated(generated: AIReadinessPackage): SourceMetadata {
  const lastCheckedAt = new Date(generated.lastChecked);
  if (Number.isNaN(lastCheckedAt.getTime())) {
    throw new Error("official source has invalid checked date");
  }
  return {
    sourceName: generated.sourceOrganization,
    sourceTitle: generated.sourceTitle,
    sourceUrl: generated.sourceUrl,
    lastCheckedAt,
    verificationSources: generated.verificationSources.length
      ? generated.verificationSources
      : [{
        title: generated.sourceTitle,
        organization: generated.sourceOrganization,
        url: generated.sourceUrl,
        type: "official",
        retrievedAt: generated.lastChecked,
      }],
    lastVerifiedAt: generated.lastVerifiedAt ? new Date(generated.lastVerifiedAt) : lastCheckedAt,
    verificationStatus: "verified",
  };
}

function sourceUpdateForPack(pack: PackageForBackfill, metadata: SourceMetadata) {
  const update: Record<string, unknown> = {};
  const hasPlaceholder = isPlaceholder(pack.sourceName) || isPlaceholder(pack.sourceTitle);

  if (!pack.sourceName || hasPlaceholder) update.sourceName = metadata.sourceName;
  if (!pack.sourceTitle || hasPlaceholder) update.sourceTitle = metadata.sourceTitle;
  if (!pack.sourceUrl || hasPlaceholder) update.sourceUrl = metadata.sourceUrl;
  if (!pack.lastCheckedAt || hasPlaceholder) update.lastCheckedAt = metadata.lastCheckedAt;
  if (!hasVerificationSources(pack.verificationSources) || hasPlaceholder) update.verificationSources = metadata.verificationSources;
  if (!pack.lastVerifiedAt || hasPlaceholder) update.lastVerifiedAt = metadata.lastVerifiedAt;
  if (pack.verificationStatus !== "verified" || hasPlaceholder) update.verificationStatus = metadata.verificationStatus;
  if (isPlaceholder(pack.sourceName) || pack.verificationStatus !== "verified") update.sourceType = "official";

  return update;
}

function promptForPack(pack: PackageForBackfill) {
  const requirements = pack.requirements
    .map((requirement) => `${requirement.title} (${requirement.documentType}, ${requirement.group}, owner ${requirement.owner}, ${requirement.required ? "required" : "optional"})`)
    .join("; ");
  return [
    `Backfill official source metadata for LifePack package: ${pack.title}.`,
    `Category: ${pack.category}.`,
    `Description: ${pack.description}.`,
    `Requirements: ${requirements}.`,
    "Find the most specific official authority page supporting these requirements.",
  ].join("\n");
}

function normalizeVerificationSources(
  value: unknown,
  title: string,
  organization: string,
  url: string,
  checkedAt: Date,
): AIReadinessPackage["verificationSources"] {
  if (Array.isArray(value) && value.length) return value as AIReadinessPackage["verificationSources"];
  return [{
    title,
    organization,
    url,
    type: "official",
    retrievedAt: checkedAt.toISOString(),
  }];
}

function cacheKeyForPack(pack: PackageForBackfill) {
  const requirementTypes = pack.requirements
    .map((requirement) => requirement.documentType)
    .sort()
    .join(",");
  return `${normalizeSearchText(pack.title)}|${normalizeSearchText(pack.category)}|${requirementTypes}`;
}

function hasVerificationSources(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function isPlaceholder(value: string | null) {
  return Boolean(value && /lifepack ai|ai generated|needs verification/i.test(value));
}

function readOptions() {
  const args = new Set(process.argv.slice(2));
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const batchArg = process.argv.find((arg) => arg.startsWith("--batch-size="));
  const limit = numberOption(limitArg?.split("=")[1], numberOption(process.env.PACKAGE_SOURCE_BACKFILL_LIMIT, 500));
  const batchSize = numberOption(batchArg?.split("=")[1], numberOption(process.env.PACKAGE_SOURCE_BACKFILL_BATCH_SIZE, DEFAULT_BATCH_SIZE));
  return {
    apply: args.has("--apply") || process.env.PACKAGE_SOURCE_BACKFILL_APPLY === "true",
    useAi: args.has("--use-ai") || process.env.PACKAGE_SOURCE_BACKFILL_USE_AI === "true",
    batchSize: Math.min(Math.max(1, batchSize), 50),
    limit: Math.max(1, limit),
  };
}

function numberOption(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function log(status: "dry-run" | "updated" | "skipped" | "failed", pack: PackageForBackfill, details: Record<string, unknown>) {
  console.info("[LifePack Package Source Backfill]", {
    status,
    id: pack.id,
    slug: pack.slug || slugify(pack.title),
    title: pack.title,
    ...details,
  });
}

void main()
  .catch((error) => {
    console.error("[LifePack Package Source Backfill] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
