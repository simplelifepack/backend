import { Router } from "express";

import { prisma } from "../../lib/prisma";
import { requireAdminAuth } from "../../middleware/adminAuth";
import { quotaPeriod } from "../../services/accountUsage.service";
import { getActiveDocumentEncryptionKey } from "../../services/documentEncryptionKeyring";

const router = Router();
router.use(requireAdminAuth);

// Visible to every role (the design doc's access matrix has "View account
// metadata and usage" as Yes/View for all four roles) — no capability gate.
router.get("/stats", async (_req, res, next) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const period = quotaPeriod();

    const [totalUsers, newUsersThisWeek, totalDocuments, pendingClassification, aiUsage] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.document.count({ where: { deletedAt: null } }),
      prisma.document.count({ where: { deletedAt: null, classificationStatus: "pending" } }),
      prisma.userAIUsage.aggregate({ where: { period }, _sum: { actionCount: true } }),
    ]);

    return res.json({
      totalUsers,
      newUsersThisWeek,
      totalDocuments,
      pendingClassification,
      aiActionsThisMonth: aiUsage._sum.actionCount ?? 0,
      period,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

type ActionItem = { label: string; count: number; oldestAt: string | null; navTo: string };
type ActionGroup = { key: string; label: string; items: ActionItem[] };

router.get("/action-center", async (_req, res, next) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Active key is a config lookup, not a DB query — do it once and reuse.
    // If it's not configured at all (deploys without any RSA key material),
    // treat the security check as unavailable rather than failing the whole
    // action center for everything else.
    let activeKeyId: string | null = null;
    try {
      activeKeyId = getActiveDocumentEncryptionKey().keyId;
    } catch {
      activeKeyId = null;
    }

    const [
      packsAwaitingReview,
      staleSourcePacks,
      stuckClassification,
      failedHealthExtractions,
      storageCleanupPending,
      legacyKeyDocuments,
      gmailScanErrors,
    ] = await Promise.all([
      prisma.readinessPack.aggregate({
        where: { deletedAt: null, verificationStatus: "needs_review" },
        _count: true, _min: { createdAt: true },
      }),
      prisma.readinessPack.aggregate({
        where: { deletedAt: null, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: ninetyDaysAgo } }] },
        _count: true, _min: { lastCheckedAt: true },
      }),
      prisma.document.aggregate({
        where: { deletedAt: null, classificationStatus: "pending", createdAt: { lt: oneHourAgo } },
        _count: true, _min: { createdAt: true },
      }),
      prisma.healthDocument.aggregate({
        where: { processingError: { not: null } },
        _count: true, _min: { createdAt: true },
      }),
      prisma.storageCleanup.aggregate({ _count: true, _min: { createdAt: true } }),
      activeKeyId
        ? prisma.document.aggregate({
            where: { deletedAt: null, OR: [{ keyId: null }, { keyId: { not: activeKeyId } }] },
            _count: true, _min: { createdAt: true },
          })
        : Promise.resolve(null),
      prisma.externalConnection.aggregate({
        where: { provider: "gmail", lastScanError: { not: null } },
        _count: true, _min: { lastScannedAt: true },
      }),
    ]);

    const groups: ActionGroup[] = [
      {
        key: "catalogue", label: "Catalogue",
        items: [
          { label: "Packs awaiting review", count: packsAwaitingReview._count, oldestAt: packsAwaitingReview._min.createdAt?.toISOString() ?? null, navTo: "catalogue" },
          { label: "Live packs with a source checked over 90 days ago", count: staleSourcePacks._count, oldestAt: staleSourcePacks._min.lastCheckedAt?.toISOString() ?? null, navTo: "catalogue" },
        ],
      },
      {
        key: "pipelines", label: "Pipelines",
        items: [
          { label: "Documents pending classification for over 1 h", count: stuckClassification._count, oldestAt: stuckClassification._min.createdAt?.toISOString() ?? null, navTo: "pipelines" },
          { label: "Health extractions with an error", count: failedHealthExtractions._count, oldestAt: failedHealthExtractions._min.createdAt?.toISOString() ?? null, navTo: "pipelines" },
          { label: "Storage deletions retrying", count: storageCleanupPending._count, oldestAt: storageCleanupPending._min.createdAt?.toISOString() ?? null, navTo: "pipelines" },
        ],
      },
      {
        key: "security", label: "Security",
        items: legacyKeyDocuments
          ? [{ label: "Documents not on the active encryption key", count: legacyKeyDocuments._count, oldestAt: legacyKeyDocuments._min.createdAt?.toISOString() ?? null, navTo: "security" }]
          : [],
      },
      {
        key: "integrations", label: "Integrations",
        items: [
          { label: "Gmail connections with a scan error", count: gmailScanErrors._count, oldestAt: gmailScanErrors._min.lastScannedAt?.toISOString() ?? null, navTo: "integrations" },
        ],
      },
    ].map((group) => ({ ...group, items: group.items.filter((item) => item.count > 0) }))
      .filter((group) => group.items.length > 0);

    const totalCount = groups.reduce((sum, group) => sum + group.items.reduce((s, item) => s + item.count, 0), 0);

    return res.json({ groups, totalCount, generatedAt: now.toISOString() });
  } catch (error) {
    return next(error);
  }
});

export default router;
