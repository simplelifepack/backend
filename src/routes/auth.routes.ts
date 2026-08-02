import { Router } from "express";

import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { authLimiter, tokenRefreshLimiter } from "../middleware/security";
import * as authService from "../services/auth.service";

const router = Router();

router.post("/signup", authLimiter, async (req, res, next) => {
  try {
    const result = await authService.signup(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const result = await authService.login(req.body, {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/google", authLimiter, async (req, res, next) => {
  try {
    const result = await authService.googleLogin(req.body, undefined, {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/refresh", tokenRefreshLimiter, async (req, res, next) => {
  try {
    const result = await authService.refresh(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const result = await authService.logout(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/forgot-password", authLimiter, (req, res, next) => {
  try {
    const result = authService.forgotPassword(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  const { authUser } = req as AuthenticatedRequest;
  res.json({
    user: authUser,
  });
});

export default router;
