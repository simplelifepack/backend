import { Router } from "express";

import { requireAdminSeedToken } from "../middleware/security";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { downloadAccountExport, getAccountExportJob, requestAccountExport } from "../services/accountExport.service";
import { processDueAccountDeletions, scheduleAccountDeletion } from "../services/accountDeletion.service";

const router = Router();
router.use(requireAuth);

router.post("/export", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const job = await requestAccountExport(authUser.id);
    return res.status(job.status === "REQUESTED" ? 202 : 200).json(job);
  } catch (error) {
    return next(error);
  }
});

router.get("/export/:jobId", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await getAccountExportJob(authUser.id, req.params.jobId));
  } catch (error) {
    return next(error);
  }
});

router.get("/export/:jobId/download", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const { data, fileName } = await downloadAccountExport(authUser.id, req.params.jobId);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(data);
  } catch (error) {
    return next(error);
  }
});

router.post("/deletion", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await scheduleAccountDeletion(authUser.id, req.body));
  } catch (error) {
    return next(error);
  }
});

export const adminAccountRouter = Router();
adminAccountRouter.post("/deletions/process", requireAdminSeedToken, async (_req, res, next) => {
  try {
    return res.json(await processDueAccountDeletions());
  } catch (error) {
    return next(error);
  }
});

export default router;
