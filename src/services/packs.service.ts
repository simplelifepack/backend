import { prisma } from "../lib/prisma";
import { normalizeDocumentType, slugify } from "./readiness/normalization";
import { readinessPackSeeds } from "./readiness/readinessPackData";
import { seedReadinessPacks } from "./readiness/readiness.service";
import { decryptJson } from "../utils/documentEncryption";
import { buildDocumentMetadata, normalizeDocumentOwner } from "./readiness/documentMetadata";
import { matchRequirementMetadata } from "./readiness/metadataMatcher";

export async function ensureReadinessPacks() {
  const count = await prisma.readinessPack.count();
  const passportApplicationPack = await prisma.readinessPack.findUnique({
    where: { slug: "passport-application-pack" },
    select: { id: true },
  });

  if (count !== readinessPackSeeds.length || !passportApplicationPack) {
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
      category: true,
      aliases: true,
      description: true,
      keywords: true,
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
