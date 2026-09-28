import { Router } from "express";

import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { getUserPreferences, updateUserPreferences } from "../services/userPreferences.service";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    return res.json(await getUserPreferences(authUser.id));
  } catch (error) {
    return next(error);
  }
});

router.patch("/", async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    return res.json(await updateUserPreferences(authUser.id, req.body));
  } catch (error) {
    return next(error);
  }
});

export default router;
