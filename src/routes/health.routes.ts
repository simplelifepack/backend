import { Router } from "express";

import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import {
  createHealthMember,
  createHealthRecord,
  createManualReminder,
  deleteHealthMember,
  deleteHealthRecord,
  reprocessHealthRecord,
  disableTrackedMetric,
  enableTrackedMetric,
  getHealthRecord,
  getOverview,
  getTimeline,
  listActiveHealthReminders,
  listHealthMembers,
  listHealthRecords,
  listMeasurements,
  listTrackedMetrics,
  searchAvailableMetrics,
  updateHealthMember,
} from "../services/health.service";

const router = Router();
router.use(requireAuth);

router.get("/members", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await listHealthMembers(authUser.id, authUser.name));
  } catch (error) {
    return next(error);
  }
});

router.post("/members", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.status(201).json(await createHealthMember(authUser.id, req.body));
  } catch (error) {
    return next(error);
  }
});

router.patch("/members/:memberId", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await updateHealthMember(authUser.id, req.params.memberId, req.body));
  } catch (error) {
    return next(error);
  }
});

router.delete("/members/:memberId", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    await deleteHealthMember(authUser.id, req.params.memberId);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/members/:memberId/overview", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await getOverview(authUser.id, req.params.memberId));
  } catch (error) {
    return next(error);
  }
});

router.get("/members/:memberId/records", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await listHealthRecords(authUser.id, req.params.memberId));
  } catch (error) {
    return next(error);
  }
});

router.post("/records", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.status(201).json(await createHealthRecord(authUser.id, req.body));
  } catch (error) {
    return next(error);
  }
});

router.get("/records/:recordId", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await getHealthRecord(authUser.id, req.params.recordId));
  } catch (error) {
    return next(error);
  }
});

router.delete("/records/:recordId", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    await deleteHealthRecord(authUser.id, req.params.recordId);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/records/:recordId/reprocess", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await reprocessHealthRecord(authUser.id, req.params.recordId));
  } catch (error) {
    return next(error);
  }
});

router.get("/members/:memberId/measurements", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await listMeasurements(authUser.id, req.params.memberId, { metric: typeof req.query.metric === "string" ? req.query.metric : undefined }));
  } catch (error) {
    return next(error);
  }
});

router.get("/members/:memberId/tracked-metrics", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await listTrackedMetrics(authUser.id, req.params.memberId));
  } catch (error) {
    return next(error);
  }
});

router.post("/members/:memberId/tracked-metrics", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.status(201).json(await enableTrackedMetric(authUser.id, req.params.memberId, req.body));
  } catch (error) {
    return next(error);
  }
});

router.delete("/members/:memberId/tracked-metrics/:trackedId", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    await disableTrackedMetric(authUser.id, req.params.memberId, req.params.trackedId);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/members/:memberId/available-metrics", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await searchAvailableMetrics(authUser.id, req.params.memberId, typeof req.query.search === "string" ? req.query.search : ""));
  } catch (error) {
    return next(error);
  }
});

router.get("/members/:memberId/timeline", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await getTimeline(authUser.id, req.params.memberId));
  } catch (error) {
    return next(error);
  }
});

router.get("/reminders", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await listActiveHealthReminders(authUser.id));
  } catch (error) {
    return next(error);
  }
});

router.post("/reminders", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.status(201).json(await createManualReminder(authUser.id, req.body));
  } catch (error) {
    return next(error);
  }
});

export default router;
