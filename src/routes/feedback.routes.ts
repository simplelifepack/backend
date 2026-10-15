import { Router } from "express";

import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { submitFeedback } from "../services/feedback.service";

const router = Router();
router.use(requireAuth);

router.post("/", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const result = await submitFeedback(authUser.id, authUser.email, req.body);
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
