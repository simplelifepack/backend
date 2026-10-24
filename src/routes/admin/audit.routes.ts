import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma";
import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import { requireCapability } from "../../middleware/adminRbac";
import { getRetentionStatus, verifyAuditChain } from "../../services/adminAudit.service";
import { listAuditChainVerifyJobs, runAuditChainVerifyJob } from "../../services/jobs/auditChainVerifyJob.service";

const router = Router();
router.use(requireAdminAuth);

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).catch(50),
  action: z.string().trim().min(1).max(80).optional(),
});

// Phase 0 ships read access gated by audit.read; "own" vs full history (per
// the design doc's access matrix) is a Phase 1 UI filter, not enforced here yet.
router.get("/", requireCapability("audit.read"), async (req, res, next) => {
  try {
    const { limit, action } = listSchema.parse(req.query);
    const { adminUser, grant } = req as AdminAuthenticatedRequest;
    const rows = await prisma.adminAuditLog.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(grant === "own" ? { adminId: adminUser.id } : {}),
      },
      orderBy: { at: "desc" },
      take: limit,
    });
    return res.json({ items: rows });
  } catch (error) {
    return next(error);
  }
});

router.post("/verify-chain", requireCapability("audit.read"), async (_req, res, next) => {
  try {
    return res.json(await verifyAuditChain());
  } catch (error) {
    return next(error);
  }
});

router.get("/retention", requireCapability("audit.read"), async (_req, res, next) => {
  try {
    return res.json(await getRetentionStatus());
  } catch (error) {
    return next(error);
  }
});

// Persisted, alertable sibling of POST /verify-chain above — same check,
// but recorded as a Job (history + the existing job_failed alert hook) so a
// broken chain can be caught by a cron-triggered run even when no admin is
// looking, not just when someone happens to click "Verify chain integrity".
router.get("/chain-verify/history", requireCapability("audit.read"), async (_req, res, next) => {
  try {
    return res.json({ jobs: await listAuditChainVerifyJobs() });
  } catch (error) {
    return next(error);
  }
});

router.post("/chain-verify/run", requireCapability("audit.read"), async (req, res, next) => {
  try {
    const { adminUser } = req as AdminAuthenticatedRequest;
    const job = await runAuditChainVerifyJob({ adminId: adminUser.id, actorEmail: adminUser.email });
    return res.json({ job });
  } catch (error) {
    return next(error);
  }
});

export default router;
