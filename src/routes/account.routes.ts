import { pipeline } from "node:stream/promises";
import { createAdmissionLimit } from "../middleware/resourceLimits";
import { Router } from "express";

import { requireAdminSeedToken } from "../middleware/security";
import { requireAuth, requireFreshAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { streamAccountExport, getAccountExportJob, requestAccountExport } from "../services/accountExport.service";
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

router.get("/export/:jobId/download", createAdmissionLimit(2), async (req, res, next) => {
  const controller = new AbortController();
  const cancel = () => { if (!res.writableFinished) controller.abort(); };
  res.once("close", cancel);
  let download: Awaited<ReturnType<typeof streamAccountExport>> | undefined;
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    download = await streamAccountExport(authUser.id, String(req.params.jobId), controller.signal);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${download.fileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    await pipeline(download.stream, res, { signal: controller.signal });
  } catch (error) { next(error); }
  finally { res.removeListener("close", cancel); await download?.dispose(); }
});

router.post("/deletion", requireFreshAuth, async (req, res, next) => {
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
