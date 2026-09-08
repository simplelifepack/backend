import { drainStorageCleanup } from "../services/storageCleanup.service";
import { getAccountUsage } from "../services/accountUsage.service";
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
    const [usage, documentCount] = await Promise.all([
      getAccountUsage(authUser.id),
      prisma.document.count({
        where: { ownerProfileId: authUser.id, deletedAt: null },
      }),
    ]);

    return res.json({
      user: { id: authUser.id, name: authUser.name, email: authUser.email },
      ...usage,
      documentCount,
      version: "1",
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
