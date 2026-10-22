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

// Confirmed 21 Oct merging the admin console branch: main's 16 Oct
// field-level encryption work (src/privacy/) outright forbids
// .aggregate()/.groupBy() on ANY encrypted model, unconditionally — not
// just when the predicate touches a protected field ("PRIVATE_AGGREGATION_
// REQUIRES_AUTHORIZED_APPLICATION_PROCESSING" fires even for
// Document.classificationStatus, which IS on operationalFields.ts's
// allowlist). This broke this endpoint's every single metric, reproduced
// on a clean DB with zero records — pre-dates and is unrelated to any
// admin console data.
//
// Fix, case by case:
//   - Document (stuckClassification, legacyKeyDocuments): predicate is
//     entirely operational fields (deletedAt/classificationStatus/keyId/
//     createdAt) — .count()+.findFirst() genuinely works, not a stopgap.
//   - ReadinessPack (packsAwaitingReview, staleSourcePacks): predicate
//     touches verificationStatus/lastCheckedAt, which aren't on the
//     allowlist — and genuinely can't be added to it: an AI-generated
//     pack is deliberately private until reviewed (isPublicDefinition
//     only exempts createdBy:"seed" rows), so this field has to stay
//     encrypted for those rows. count() still fails (hasPrivatePredicate).
//   - HealthDocument (failedHealthExtractions), ExternalConnection
//     (gmailScanErrors): same — processingError/lastScanError aren't
//     operational, count() still fails.
// The 3 genuinely-still-broken metrics degrade gracefully (0, unavailable
// logged) instead of 500ing the whole dashboard; a real fix needs an
// authorized application-level aggregation path, per main's own error
// message — an architectural call for the privacy layer's own author, not
// something to improvise here. Flagged in admin-web/TRACKER.md.
async function countOldest<K extends string>(
  label: string,
  oldestField: K,
  count: () => Promise<number>,
  oldest: () => Promise<Record<K, Date | null> | null>,
): Promise<{ _count: number; _min: Record<K, Date | null> }> {
  try {
    const [total, first] = await Promise.all([count(), oldest()]);
    return { _count: total, _min: first ?? ({ [oldestField]: null } as Record<K, Date | null>) };
  } catch (error) {
    console.error({ event: "action_center_metric_unavailable", label, errorCode: error instanceof Error ? error.message : "unknown" });
    return { _count: 0, _min: { [oldestField]: null } as Record<K, Date | null> };
  }
}

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
      countOldest(
        "packsAwaitingReview", "createdAt",
        () => prisma.readinessPack.count({ where: { deletedAt: null, verificationStatus: "needs_review" } }),
        () => prisma.readinessPack.findFirst({ where: { deletedAt: null, verificationStatus: "needs_review" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      ),
      countOldest(
        "staleSourcePacks", "lastCheckedAt",
        () => prisma.readinessPack.count({ where: { deletedAt: null, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: ninetyDaysAgo } }] } }),
        () => prisma.readinessPack.findFirst({ where: { deletedAt: null, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: ninetyDaysAgo } }] }, orderBy: { lastCheckedAt: "asc" }, select: { lastCheckedAt: true } }),
      ),
      countOldest(
        "stuckClassification", "createdAt",
        () => prisma.document.count({ where: { deletedAt: null, classificationStatus: "pending", createdAt: { lt: oneHourAgo } } }),
        () => prisma.document.findFirst({ where: { deletedAt: null, classificationStatus: "pending", createdAt: { lt: oneHourAgo } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      ),
      countOldest(
        "failedHealthExtractions", "createdAt",
        () => prisma.healthDocument.count({ where: { processingError: { not: null } } }),
        () => prisma.healthDocument.findFirst({ where: { processingError: { not: null } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      ),
      prisma.storageCleanup.aggregate({ _count: true, _min: { createdAt: true } }),
      activeKeyId
        ? countOldest(
            "legacyKeyDocuments", "createdAt",
            () => prisma.document.count({ where: { deletedAt: null, OR: [{ keyId: null }, { keyId: { not: activeKeyId } }] } }),
            () => prisma.document.findFirst({ where: { deletedAt: null, OR: [{ keyId: null }, { keyId: { not: activeKeyId } }] }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
          )
        : Promise.resolve(null),
      countOldest(
        "gmailScanErrors", "lastScannedAt",
        () => prisma.externalConnection.count({ where: { provider: "gmail", lastScanError: { not: null } } }),
        () => prisma.externalConnection.findFirst({ where: { provider: "gmail", lastScanError: { not: null } }, orderBy: { lastScannedAt: "asc" }, select: { lastScannedAt: true } }),
      ),
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
