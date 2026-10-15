import { drainStorageCleanup } from "../services/storageCleanup.service";
import { getAccountUsage } from "../services/accountUsage.service";
import { getPublicSystemConfig } from "../services/systemSettings.service";
import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";

const router = Router();
router.use(requireAuth);

router.get("/usage", async (req, res, next) => {
  try { const id = (req as AuthenticatedRequest).authUser.id; await drainStorageCleanup(id); return res.json(await getAccountUsage(id)); } catch (error) { return next(error); }
});

router.get("/", async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const [usage, documentCount, user, systemConfig] = await Promise.all([
      getAccountUsage(authUser.id),
      prisma.document.count({
        where: { ownerProfileId: authUser.id, deletedAt: null },
      }),
      prisma.user.findUnique({
        where: { id: authUser.id },
        select: { pinHash: true },
      }),
      getPublicSystemConfig(),
    ]);

    return res.json({
      user: { id: authUser.id, name: authUser.name, email: authUser.email, pinConfigured: Boolean(user?.pinHash) },
      ...usage,
      documentCount,
      version: "1",
      // Additive (Phase 3, Comms & system) — a client build that predates
      // this field simply never looks at it. `maintenanceMode.active` here
      // is a value the client *could* act on; nothing server-side currently
      // enforces it — see the tracker for why that's a separate decision.
      systemConfig,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
