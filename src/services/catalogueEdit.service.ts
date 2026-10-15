import { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { writeAuditLog } from "./adminAudit.service";
import { activeRequirementsWhere } from "./readiness/activeRequirements";

export class CatalogueEditError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "CatalogueEditError";
    this.statusCode = statusCode;
  }
}

// Scope for this pass: top-level pack fields only. Requirements are captured
// in every snapshot (so a future requirements editor has real history to
// work with) but aren't editable here, and rollback restores pack fields
// only — see the tracker note on this item for why that's a deliberate,
// documented limitation rather than an oversight.
const EDITABLE_PACK_FIELDS = [
  "title", "subtitle", "category", "description",
  "sourceType", "sourceName", "sourceTitle", "sourceUrl", "verificationStatus",
] as const;
export type EditablePackField = (typeof EDITABLE_PACK_FIELDS)[number];
// Nullability mirrors the actual schema — title/category/description/
// sourceType/verificationStatus are non-nullable String columns; only
// subtitle/sourceName/sourceTitle/sourceUrl can be cleared to null.
export type PackEditInput = {
  title?: string; category?: string; description?: string; sourceType?: string; verificationStatus?: string;
  subtitle?: string | null; sourceName?: string | null; sourceTitle?: string | null; sourceUrl?: string | null;
};

type PackSnapshot = {
  title: string; subtitle: string | null; category: string; description: string;
  sourceType: string; sourceName: string | null; sourceTitle: string | null; sourceUrl: string | null;
  lastCheckedAt: string | null; verificationSources: unknown; lastVerifiedAt: string | null;
  verificationStatus: string; version: number;
  requirements: Array<{
    id: string; title: string; documentType: string; owner: string; description: string;
    required: boolean; group: string; acceptedDocumentTypes: string[]; alternativeLabels: string[]; sortOrder: number;
  }>;
};

type PackForSnapshot = {
  title: string; subtitle: string | null; category: string; description: string;
  sourceType: string; sourceName: string | null; sourceTitle: string | null; sourceUrl: string | null;
  lastCheckedAt: Date | null; verificationSources: unknown; lastVerifiedAt: Date | null;
  verificationStatus: string; version: number;
  requirements: Array<{
    id: string; title: string; documentType: string; owner: string; description: string;
    required: boolean; group: string; acceptedDocumentTypes: string[]; alternativeLabels: string[]; sortOrder: number;
  }>;
};

function toSnapshot(pack: PackForSnapshot): PackSnapshot {
  return {
    title: pack.title, subtitle: pack.subtitle, category: pack.category, description: pack.description,
    sourceType: pack.sourceType, sourceName: pack.sourceName, sourceTitle: pack.sourceTitle, sourceUrl: pack.sourceUrl,
    lastCheckedAt: pack.lastCheckedAt?.toISOString() ?? null, verificationSources: pack.verificationSources,
    lastVerifiedAt: pack.lastVerifiedAt?.toISOString() ?? null, verificationStatus: pack.verificationStatus, version: pack.version,
    requirements: pack.requirements.map((r) => ({
      id: r.id, title: r.title, documentType: r.documentType, owner: r.owner, description: r.description,
      required: r.required, group: r.group, acceptedDocumentTypes: r.acceptedDocumentTypes,
      alternativeLabels: r.alternativeLabels, sortOrder: r.sortOrder,
    })),
  };
}

async function loadPackWithRequirements(where: { id: string } | { slug: string }) {
  const pack = await prisma.readinessPack.findFirst({
    where: { ...where, deletedAt: null },
    include: { requirements: { where: activeRequirementsWhere, orderBy: { sortOrder: "asc" } } },
  });
  if (!pack) throw new CatalogueEditError("Pack not found.", 404);
  return pack;
}

type AdminCtx = { adminId: string; actorEmail: string };

export async function editPack(ctx: AdminCtx, slug: string, updates: PackEditInput, reason: string) {
  const before = await loadPackWithRequirements({ slug });

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(updates) as EditablePackField[]) {
    if (!EDITABLE_PACK_FIELDS.includes(key)) continue;
    const newValue = updates[key];
    const oldValue = before[key];
    if (newValue !== undefined && newValue !== oldValue) diff[key] = { from: oldValue, to: newValue };
  }
  if (Object.keys(diff).length === 0) throw new CatalogueEditError("No changes to apply.", 409);

  return prisma.$transaction(async (tx) => {
    await tx.packRevision.create({
      data: {
        packId: before.id, version: before.version,
        snapshot: toSnapshot(before) as unknown as Prisma.InputJsonValue,
        editedBy: ctx.adminId, reason,
      },
    });
    const updated = await tx.readinessPack.update({
      where: { id: before.id },
      data: { ...updates, version: { increment: 1 } },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "pack.edit",
      targetType: "ReadinessPack", targetId: before.id, reason, diff,
    });
    return updated;
  });
}

export async function listPackRevisions(slug: string) {
  const pack = await prisma.readinessPack.findFirst({ where: { slug, deletedAt: null }, select: { id: true } });
  if (!pack) throw new CatalogueEditError("Pack not found.", 404);
  return prisma.packRevision.findMany({ where: { packId: pack.id }, orderBy: { version: "desc" } });
}

/** Restores a prior revision's pack-level fields onto the live pack.
 * Requirements are captured in every snapshot but not restored by rollback
 * in this pass — see the EDITABLE_PACK_FIELDS comment above. The pre-rollback
 * state is itself snapshotted first, so a rollback can always be undone by
 * rolling back again. */
export async function rollbackPack(ctx: AdminCtx, slug: string, revisionId: string, reason: string) {
  const current = await loadPackWithRequirements({ slug });

  const revision = await prisma.packRevision.findUnique({ where: { id: revisionId } });
  if (!revision || revision.packId !== current.id) throw new CatalogueEditError("Revision not found for this pack.", 404);

  const snapshot = revision.snapshot as unknown as PackSnapshot;

  return prisma.$transaction(async (tx) => {
    await tx.packRevision.create({
      data: {
        packId: current.id, version: current.version,
        snapshot: toSnapshot(current) as unknown as Prisma.InputJsonValue,
        editedBy: ctx.adminId, reason: `Pre-rollback snapshot (rolling back to v${revision.version})`,
      },
    });
    const updated = await tx.readinessPack.update({
      where: { id: current.id },
      data: {
        title: snapshot.title, subtitle: snapshot.subtitle, category: snapshot.category, description: snapshot.description,
        sourceType: snapshot.sourceType, sourceName: snapshot.sourceName, sourceTitle: snapshot.sourceTitle, sourceUrl: snapshot.sourceUrl,
        verificationStatus: snapshot.verificationStatus,
        version: { increment: 1 },
      },
    });
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "pack.rollback",
      targetType: "ReadinessPack", targetId: current.id, reason,
      diff: { fromVersion: current.version, toRevisionVersion: revision.version, revisionId },
    });
    return updated;
  });
}

// --- Merge duplicates ------------------------------------------------------

type MergeResult = {
  primaryPackId: string;
  duplicatePackId: string;
  requirementsCopied: number;
  requirementsAlreadyPresent: number;
};

/** Merges `duplicateSlug` into `primarySlug`: copies over any active
 * requirement the duplicate has that the primary doesn't (matched by
 * case-insensitive, trimmed title — not touched if an equivalent already
 * exists), then soft-deletes the duplicate pack and its requirements. The
 * primary's pre-merge state is snapshotted as a revision first, same as
 * `editPack`/`rollbackPack` — though note rollback only restores pack-level
 * fields today (see the module comment above), so a merge's requirement
 * changes aren't restorable via the existing rollback action yet; only the
 * duplicate pack's own soft-delete would need a direct, UI-unexposed DB
 * fix to undo.
 *
 * Refuses to merge (rather than silently reassigning or discarding) if any
 * real user already has a `RequirementAssignment` against one of the
 * duplicate's active requirements — soft-deleting that requirement would
 * silently drop it out of the user's active readiness view with no
 * equivalent guaranteed on the primary. This is the one case this action
 * will not attempt to resolve automatically. */
export async function mergePacks(ctx: AdminCtx, primarySlug: string, duplicateSlug: string, reason: string) {
  if (primarySlug === duplicateSlug) throw new CatalogueEditError("Can't merge a pack into itself.", 400);

  const primary = await loadPackWithRequirements({ slug: primarySlug });
  const duplicate = await loadPackWithRequirements({ slug: duplicateSlug });

  const assignmentCount = await prisma.requirementAssignment.count({
    where: { requirementId: { in: duplicate.requirements.map((r) => r.id) } },
  });
  if (assignmentCount > 0) {
    throw new CatalogueEditError(
      `${assignmentCount} user document assignment(s) already reference this pack's requirements — refusing to merge rather than silently drop them. Resolve those assignments first.`,
      409,
    );
  }

  const primaryTitles = new Set(primary.requirements.map((r) => r.title.trim().toLowerCase()));
  const toCopy = duplicate.requirements.filter((r) => !primaryTitles.has(r.title.trim().toLowerCase()));
  let nextSortOrder = primary.requirements.length
    ? Math.max(...primary.requirements.map((r) => r.sortOrder)) + 1
    : 0;

  const result = await prisma.$transaction(async (tx) => {
    await tx.packRevision.create({
      data: {
        packId: primary.id, version: primary.version,
        snapshot: toSnapshot(primary) as unknown as Prisma.InputJsonValue,
        editedBy: ctx.adminId, reason: `Pre-merge snapshot (merging in ${duplicate.slug})`,
      },
    });

    for (const req of toCopy) {
      await tx.requirement.create({
        data: {
          packId: primary.id, title: req.title, documentType: req.documentType, owner: req.owner,
          metadata: req.metadata === null ? Prisma.DbNull : (req.metadata as Prisma.InputJsonValue),
          description: req.description, required: req.required, group: req.group,
          acceptedDocumentTypes: req.acceptedDocumentTypes, alternativeLabels: req.alternativeLabels,
          sortOrder: nextSortOrder++,
        },
      });
    }

    await tx.requirement.updateMany({
      where: { id: { in: duplicate.requirements.map((r) => r.id) } },
      data: { deletedAt: new Date() },
    });
    await tx.readinessPack.update({
      where: { id: duplicate.id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    await tx.readinessPack.update({
      where: { id: primary.id },
      data: { version: { increment: 1 } },
    });

    const mergeResult: MergeResult = {
      primaryPackId: primary.id, duplicatePackId: duplicate.id,
      requirementsCopied: toCopy.length, requirementsAlreadyPresent: duplicate.requirements.length - toCopy.length,
    };
    await writeAuditLog(tx, {
      adminId: ctx.adminId, actorEmail: ctx.actorEmail, action: "pack.merge",
      targetType: "ReadinessPack", targetId: primary.id, reason,
      diff: { ...mergeResult, duplicateSlug: duplicate.slug },
    });
    return mergeResult;
  });

  return result;
}
