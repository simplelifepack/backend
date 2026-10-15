import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma";
import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability, requireStepUp, requireWriteGrant } from "../../middleware/adminRbac";
import { activeRequirementsWhere } from "../../services/readiness/activeRequirements";
import { CatalogueEditError, editPack, listPackRevisions, mergePacks, rollbackPack } from "../../services/catalogueEdit.service";
import { csvTemplate, importCsv, previewCsvWithDatabase } from "../../services/adminPackages.service";
import { writeAuditLog } from "../../services/adminAudit.service";

const router = Router();
router.use(requireAdminAuth, requireCapability("packs.review"));

function adminCtx(req: AdminAuthenticatedRequest) {
  return { adminId: req.adminUser.id, actorEmail: req.adminUser.email };
}

function handleEditError(error: unknown, next: (e?: unknown) => void, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (error instanceof CatalogueEditError) return res.status(error.statusCode).json({ message: error.message });
  return next(error);
}

const SYSTEM_CREATORS = ["seed", "ai"];
const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).catch(50) });

const summarySelect = {
  id: true, slug: true, title: true, category: true, createdBy: true,
  verificationStatus: true, lastCheckedAt: true, createdAt: true, updatedAt: true,
} as const;

router.get("/review-queue", async (req, res, next) => {
  try {
    const { limit } = limitSchema.parse(req.query);
    const where = { deletedAt: null, createdBy: { in: SYSTEM_CREATORS }, verificationStatus: "needs_review" } as const;
    const [total, items] = await Promise.all([
      prisma.readinessPack.count({ where }),
      prisma.readinessPack.findMany({ where, select: summarySelect, orderBy: { createdAt: "asc" }, take: limit }),
    ]);
    return res.json({ total, items });
  } catch (error) {
    return next(error);
  }
});

router.get("/stale-sources", async (req, res, next) => {
  try {
    const { limit } = limitSchema.parse(req.query);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const where = {
      deletedAt: null, createdBy: { in: SYSTEM_CREATORS },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: ninetyDaysAgo } }],
    };
    const [total, items] = await Promise.all([
      prisma.readinessPack.count({ where }),
      prisma.readinessPack.findMany({ where, select: summarySelect, orderBy: { lastCheckedAt: "asc" }, take: limit }),
    ]);
    return res.json({ total, items });
  } catch (error) {
    return next(error);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const slug = z.string().min(1).parse(req.params.slug);
    const pack = await prisma.readinessPack.findFirst({
      where: { slug, deletedAt: null, createdBy: { in: SYSTEM_CREATORS } },
      select: {
        id: true, slug: true, title: true, subtitle: true, category: true, description: true,
        sourceType: true, sourceName: true, sourceTitle: true, sourceUrl: true,
        lastCheckedAt: true, verificationSources: true, lastVerifiedAt: true, verificationStatus: true,
        createdBy: true, version: true, createdAt: true, updatedAt: true,
        requirements: {
          where: activeRequirementsWhere,
          orderBy: { sortOrder: "asc" },
          select: { id: true, title: true, description: true, required: true, group: true, documentType: true, owner: true, acceptedDocumentTypes: true },
        },
      },
    });
    if (!pack) return res.status(404).json({ message: "Pack not found." });
    return res.json({ pack });
  } catch (error) {
    return next(error);
  }
});

const editSchema = z.object({
  title: z.string().trim().min(1).optional(),
  subtitle: z.string().trim().min(1).nullable().optional(),
  category: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  sourceType: z.string().trim().min(1).optional(),
  sourceName: z.string().trim().min(1).nullable().optional(),
  sourceTitle: z.string().trim().min(1).nullable().optional(),
  sourceUrl: z.string().trim().url().nullable().optional(),
  verificationStatus: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(3).max(500),
});

router.patch("/:slug", requireCapability("packs.publish"), requireWriteGrant, requireStepUp, async (req, res, next) => {
  try {
    const slug = z.string().min(1).parse(req.params.slug);
    const { reason, ...updates } = editSchema.parse(req.body);
    const pack = await editPack(adminCtx(req as unknown as AdminAuthenticatedRequest), slug, updates, reason);
    return res.json({ pack });
  } catch (error) {
    return handleEditError(error, next, res);
  }
});

router.get("/:slug/revisions", async (req, res, next) => {
  try {
    const slug = z.string().min(1).parse(req.params.slug);
    const revisions = await listPackRevisions(slug);
    return res.json({ revisions });
  } catch (error) {
    return handleEditError(error, next, res);
  }
});

const rollbackSchema = z.object({ reason: z.string().trim().min(3).max(500) });

router.post("/:slug/rollback/:revisionId", requireCapability("packs.rollback"), requireWriteGrant, requireStepUp, async (req, res, next) => {
  try {
    const slug = z.string().min(1).parse(req.params.slug);
    const revisionId = z.string().min(1).parse(req.params.revisionId);
    const { reason } = rollbackSchema.parse(req.body);
    const pack = await rollbackPack(adminCtx(req as unknown as AdminAuthenticatedRequest), slug, revisionId, reason);
    return res.json({ pack });
  } catch (error) {
    return handleEditError(error, next, res);
  }
});

const mergeSchema = z.object({ duplicateSlug: z.string().trim().min(1), reason: z.string().trim().min(3).max(500) });

router.post("/:slug/merge", requireCapability("packs.rollback"), requireWriteGrant, requireStepUp, async (req, res, next) => {
  try {
    const slug = z.string().min(1).parse(req.params.slug);
    const { duplicateSlug, reason } = mergeSchema.parse(req.body);
    const result = await mergePacks(adminCtx(req as unknown as AdminAuthenticatedRequest), slug, duplicateSlug, reason);
    return res.json({ result });
  } catch (error) {
    return handleEditError(error, next, res);
  }
});

// --- Bulk import -----------------------------------------------------------
// Reuses the stopgap's own pure CSV logic (csvTemplate/previewCsvWithDatabase/
// importCsv) rather than rebuilding parity from scratch — those functions
// never depended on the stopgap's own (RBAC-less, audit-less) routes, so the
// only real work here is wrapping them in the real RBAC/audit chain. See the
// tracker for the reuse-vs-rebuild decision this closes out.

router.get("/import/template", requireCapability("packs.bulk_import"), (_req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=\"catalogue-import-template.csv\"");
  return res.send(csvTemplate());
});

const importPreviewSchema = z.object({ csv: z.string().min(1) });

router.post("/import/preview", requireCapability("packs.bulk_import"), async (req, res, next) => {
  try {
    const { csv } = importPreviewSchema.parse(req.body);
    return res.json(await previewCsvWithDatabase(csv));
  } catch (error) {
    return next(error);
  }
});

const importSchema = z.object({ csv: z.string().min(1), reason: z.string().trim().min(3).max(500) });

// Not wrapped in `withAudit`'s single transaction — `importCsv` creates each
// row independently (partial success is the whole point: row 3 failing
// shouldn't roll back rows 1-2), so there's no one transaction to put the
// audit write inside. Logged immediately after instead, with the full
// per-row results in `diff` for complete traceability. A crash in the
// narrow window between import and this write is the one gap that leaves —
// accepted rather than rearchitecting the stopgap's own partial-success
// import semantics, which is exactly the "parity rebuild" this pass chose
// not to do.
router.post("/import", requireCapability("packs.bulk_import"), requireWriteGrant, requireStepUp, async (req, res, next) => {
  try {
    const { csv, reason } = importSchema.parse(req.body);
    const result = await importCsv(csv);
    const { adminUser } = req as unknown as AdminAuthenticatedRequest;
    await writeAuditLog(prisma, {
      adminId: adminUser.id, actorEmail: adminUser.email, action: "catalogue.bulk_import",
      reason, diff: { successCount: result.successCount, failedCount: result.failedCount, results: result.results },
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
