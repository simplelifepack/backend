import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma";
import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability, requireStepUp } from "../../middleware/adminRbac";
import { getAccountUsage } from "../../services/accountUsage.service";
import { withAuditedAdminAccess, writeAuditLog } from "../../services/adminAudit.service";
import { withAdminAccess } from "../../privacy/access";
import {
  AdminUsersError, cancelDeletionOnBehalf, changeUserTier, forceSignOutUser,
  listExportJobsForUser, listSignInEventsForUser, suspendUser, unsuspendUser,
} from "../../services/adminUsers.service";
import { AdminUsageError, grantOverride, listOverrides, revokeOverride } from "../../services/adminUsage.service";
import { AdminTrustError, listTrustMembersForUser, revokeTrustMemberOnBehalf } from "../../services/adminTrust.service";

const router = Router();
router.use(requireAdminAuth);

const listSchema = z.object({
  search: z.string().trim().min(1).max(160).optional(),
  tier: z.enum(["free", "paid"]).optional(),
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
});

function signInMethods(user: { passwordHash: string | null; pinHash: string | null; externalIdentities: { provider: string }[] }) {
  const methods: string[] = [];
  if (user.passwordHash) methods.push("Password");
  for (const identity of user.externalIdentities) methods.push(identity.provider === "google" ? "Google" : identity.provider);
  if (user.pinHash) methods.push("PIN");
  return methods;
}

router.get("/", requireCapability("users.view"), async (req, res, next) => {
  try {
    const { search, tier, page, limit } = listSchema.parse(req.query);
    const where = {
      ...(tier ? { accountTier: tier } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { email: { contains: search, mode: "insensitive" as const } }] } : {}),
    };
    // DRAFT: withAuditedAdminAccess (proposal, not yet reviewed — see
    // src/privacy/access.ts). Also note: `search` filters by name/email
    // (encrypted, `contains`+insensitive) — whether that's honored
    // correctly post-decryption or silently ignored at the SQL level is a
    // separate, unverified question this draft doesn't address.
    const { adminUser } = req as unknown as AdminAuthenticatedRequest;
    const [total, items] = await withAuditedAdminAccess(
      { adminId: adminUser.id, actorEmail: adminUser.email },
      { capability: "users.view", action: "user.list_view" },
      () => Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          select: {
            id: true, name: true, email: true, accountTier: true, createdAt: true,
            passwordHash: true, pinHash: true,
            externalIdentities: { select: { provider: true } },
            scheduledDeletionAt: true, suspendedAt: true,
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]),
    );
    return res.json({
      items: items.map((u) => ({
        id: u.id, name: u.name, email: u.email, accountTier: u.accountTier,
        createdAt: u.createdAt, signInMethods: signInMethods(u),
        pendingDeletion: Boolean(u.scheduledDeletionAt),
        suspended: Boolean(u.suspendedAt),
      })),
      pagination: { page, limit, total, hasNextPage: page * limit < total },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", requireCapability("users.view"), async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    // DRAFT: withAdminAccess (proposal, not yet reviewed — see
    // src/privacy/access.ts). Using the unaudited primitive directly here,
    // not withAuditedAdminAccess — that wrapper audits unconditionally once
    // work() resolves, but a not-found lookup must neither be audited as a
    // "view" nor lose its specific "User not found." message to the
    // generic error handler's message-stripping (confirmed: a thrown error
    // without a whitelisted .code gets reduced to "Request failed." — see
    // errorHandling.ts). Preserves the original control flow exactly.
    const { adminUser } = req as unknown as AdminAuthenticatedRequest;
    const user = await withAdminAccess({ adminId: adminUser.id, capability: "users.view" }, () =>
      prisma.user.findUnique({
        where: { id },
        select: {
          id: true, name: true, email: true, accountTier: true, createdAt: true,
          passwordHash: true, pinHash: true,
          externalIdentities: { select: { provider: true } },
          deletionRequestedAt: true, scheduledDeletionAt: true,
          suspendedAt: true, suspendedReason: true,
          aiProcessingEnabled: true, country: true,
        },
      }),
    );
    if (!user) return res.status(404).json({ message: "User not found." });

    const [usage, documentCount, healthMemberCount, trustMemberCount] = await Promise.all([
      getAccountUsage(id).catch(() => null),
      prisma.document.count({ where: { ownerProfileId: id, deletedAt: null } }),
      prisma.healthMember.count({ where: { userId: id } }),
      prisma.trustMember.count({ where: { ownerUserId: id, status: "ACTIVE" } }),
    ]);

    // Opening a user's record is itself logged — sensitive reads are audited,
    // not just writes (decision D4).
    await writeAuditLog(prisma, {
      adminId: adminUser.id, actorEmail: adminUser.email, action: "user.view",
      targetType: "User", targetId: id,
    });

    return res.json({
      user: {
        id: user.id, name: user.name, email: user.email, accountTier: user.accountTier,
        createdAt: user.createdAt, signInMethods: signInMethods(user),
        deletionRequestedAt: user.deletionRequestedAt, scheduledDeletionAt: user.scheduledDeletionAt,
        suspendedAt: user.suspendedAt, suspendedReason: user.suspendedReason,
        aiProcessingEnabled: user.aiProcessingEnabled, country: user.country,
      },
      usage,
      sealed: { documentCount, healthMemberCount, trustMemberCount },
    });
  } catch (error) {
    return next(error);
  }
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const tierSchema = z.object({ tier: z.enum(["free", "paid"]), reason: z.string().trim().min(3).max(500) });
const signOutSchema = z.object({ reason: z.string().trim().min(3).max(500).optional() });

function adminCtx(req: AdminAuthenticatedRequest) {
  return { adminId: req.adminUser.id, actorEmail: req.adminUser.email };
}

router.post("/:id/tier", requireCapability("users.tier.change"), requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { tier, reason } = tierSchema.parse(req.body);
    const result = await changeUserTier(adminCtx(req as unknown as AdminAuthenticatedRequest), id, tier, reason);
    return res.json({ user: result });
  } catch (error) {
    if (error instanceof AdminUsersError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.post("/:id/suspend", requireCapability("users.suspend"), requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { reason } = reasonSchema.parse(req.body);
    const result = await suspendUser(adminCtx(req as unknown as AdminAuthenticatedRequest), id, reason);
    return res.json({ user: result });
  } catch (error) {
    if (error instanceof AdminUsersError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.post("/:id/unsuspend", requireCapability("users.suspend"), requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { reason } = reasonSchema.parse(req.body);
    const result = await unsuspendUser(adminCtx(req as unknown as AdminAuthenticatedRequest), id, reason);
    return res.json({ user: result });
  } catch (error) {
    if (error instanceof AdminUsersError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.post("/:id/signout", requireCapability("users.signout"), requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { reason } = signOutSchema.parse(req.body);
    const result = await forceSignOutUser(adminCtx(req as unknown as AdminAuthenticatedRequest), id, reason);
    return res.json({ user: result });
  } catch (error) {
    if (error instanceof AdminUsersError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.get("/:id/export-jobs", requireCapability("users.view"), async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    return res.json({ jobs: await listExportJobsForUser(id) });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/sign-in-events", requireCapability("users.view"), async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    return res.json({ events: await listSignInEventsForUser(id) });
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/trust-members", requireCapability("users.view"), async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    return res.json({ members: await listTrustMembersForUser(id) });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/trust-members/:memberId/revoke", requireCapability("trust.revoke"), requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const memberId = z.string().min(1).parse(req.params.memberId);
    const { reason } = reasonSchema.parse(req.body);
    const member = await revokeTrustMemberOnBehalf(adminCtx(req as unknown as AdminAuthenticatedRequest), id, memberId, reason);
    return res.json({ member });
  } catch (error) {
    if (error instanceof AdminTrustError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

// Approval-gated (same row as "Delete an account (cascade)" in the access
// matrix — cancelling is the lower-risk half of that same lifecycle, and
// there's no separate matrix row for it). `requireStepUp` currently treats
// "approval" the same as step-up (a second-approver flow isn't built yet —
// see adminRbac.ts's own note), so this needs a fresh passkey verification.
router.post("/:id/deletion/cancel", requireCapability("users.delete"), requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { reason } = reasonSchema.parse(req.body);
    const result = await cancelDeletionOnBehalf(adminCtx(req as unknown as AdminAuthenticatedRequest), id, reason);
    return res.json({ user: result });
  } catch (error) {
    if (error instanceof AdminUsersError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.get("/:id/usage-overrides", requireCapability("users.view"), async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    return res.json({ overrides: await listOverrides(id) });
  } catch (error) {
    return next(error);
  }
});

const grantOverrideSchema = z.object({
  storageLimitMb: z.coerce.number().positive().max(10_000).optional(), // sanity cap: 10 GB, well above any plausible intentional grant
  aiActionLimit: z.coerce.number().int().positive().max(1000).optional(),
  expiresInDays: z.coerce.number().positive().max(90),
  reason: z.string().trim().min(3).max(500),
});

router.post("/:id/usage-override", requireCapability("users.tier.change"), requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { storageLimitMb, aiActionLimit, expiresInDays, reason } = grantOverrideSchema.parse(req.body);
    const override = await grantOverride(adminCtx(req as unknown as AdminAuthenticatedRequest), id, {
      storageLimitBytes: storageLimitMb != null ? Math.round(storageLimitMb * 1024 * 1024) : null,
      aiActionLimit: aiActionLimit ?? null,
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      reason,
    });
    return res.json({ override });
  } catch (error) {
    if (error instanceof AdminUsageError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.post("/:id/usage-override/revoke", requireCapability("users.tier.change"), requireStepUp, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const { reason } = reasonSchema.parse(req.body);
    const override = await revokeOverride(adminCtx(req as unknown as AdminAuthenticatedRequest), id, reason);
    return res.json({ override });
  } catch (error) {
    if (error instanceof AdminUsageError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

export default router;
