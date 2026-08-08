import { Router } from "express";

import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { createWealthRecordFromForm, getWealthFormSchema, listWealthFormCategories, listWealthFormSubtypes } from "../services/wealthForm.service";
import { getWealthHandoffSummary, sendWealthHandoff } from "../services/wealthHandoff.service";
import { createWealthRecord, listWealthRecords } from "../services/wealthRecords.service";

const router = Router();
router.use(requireAuth);

router.get("/form/categories", async (_req, res, next) => {
  try {
    return res.json(await listWealthFormCategories());
  } catch (error) {
    return next(error);
  }
});

router.get("/form/categories/:categoryCode/subtypes", async (req, res, next) => {
  try {
    return res.json(await listWealthFormSubtypes(req.params.categoryCode));
  } catch (error) {
    return next(error);
  }
});

router.get("/form/categories/:categoryCode/subtypes/:subtypeCode/schema", async (req, res, next) => {
  try {
    return res.json(await getWealthFormSchema(req.params.categoryCode, req.params.subtypeCode));
  } catch (error) {
    return next(error);
  }
});

router.post("/form/records", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.status(201).json(await createWealthRecordFromForm(authUser.id, req.body));
  } catch (error) {
    return next(error);
  }
});

router.get("/records", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await listWealthRecords(authUser.id));
  } catch (error) {
    return next(error);
  }
});

router.post("/records", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.status(201).json(await createWealthRecord(authUser.id, req.body));
  } catch (error) {
    return next(error);
  }
});

router.get("/handoff/summary", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await getWealthHandoffSummary(authUser.id));
  } catch (error) {
    return next(error);
  }
});

router.post("/handoff/send", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json(await sendWealthHandoff(authUser.id, req.body));
  } catch (error) {
    return next(error);
  }
});

export default router;
