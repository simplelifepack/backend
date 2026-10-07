import { statusCodeForError } from "../middleware/errorHandling";
import { Router } from "express";

import { requireAuth, requireFreshAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import {
  accountChangeOtpAccountLimiter,
  authLimiter,
  loginAccountLimiter,
  passwordResetRequestAccountLimiter,
  passwordResetVerifyAccountLimiter,
  signupOtpRequestAccountLimiter,
  signupOtpVerifyAccountLimiter,
  tokenRefreshLimiter,
} from "../middleware/security";
import * as authService from "../services/auth.service";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "../auth/refreshCookie";

const router = Router();

function sendAuthResult(res: Parameters<typeof setRefreshCookie>[0], result: Awaited<ReturnType<typeof authService.login>>, status = 200) {
  setRefreshCookie(res, result.refreshToken);
  const { refreshToken: _refreshToken, ...publicResult } = result;
  return res.status(status).json(publicResult);
}

router.post("/signup", authLimiter, signupOtpVerifyAccountLimiter, async (req, res, next) => {
  try {
    const result = await authService.signup(req.body);
    return sendAuthResult(res, result, 201);
  } catch (error) {
    next(error);
  }
});

router.post("/signup/request-otp", authLimiter, signupOtpRequestAccountLimiter, async (req, res, next) => {
  try {
    const result = await authService.requestSignupOtp(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/login", authLimiter, loginAccountLimiter, async (req, res, next) => {
  try {
    const result = await authService.login(req.body, {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
    return sendAuthResult(res, result);
  } catch (error) {
    next(error);
  }
});

router.post("/login/pin", authLimiter, loginAccountLimiter, async (req, res, next) => {
  try {
    const result = await authService.loginWithPin(req.body, {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
    return sendAuthResult(res, result);
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
    return sendAuthResult(res, result);
  } catch (error) {
    next(error);
  }
});

router.post("/refresh", tokenRefreshLimiter, async (req, res, next) => {
  try {
    const refreshToken = readRefreshCookie(req);
    if (!refreshToken) return res.status(401).json({ message: "Session expired." });
    const result = await authService.refresh({ refreshToken });
    return sendAuthResult(res, result);
  } catch (error) {
    if (statusCodeForError(error) === 401) clearRefreshCookie(res);
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const refreshToken = readRefreshCookie(req);
    const result = refreshToken ? await authService.logout({ refreshToken }) : { message: "Logged out." };
    clearRefreshCookie(res);
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/logout-all", requireFreshAuth, async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const result = await authService.logoutAll(authUser.id);
    clearRefreshCookie(res);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/account/change-email/request", requireFreshAuth, authLimiter, accountChangeOtpAccountLimiter, async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const result = await authService.requestEmailChange(authUser.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/account/change-email/verify", requireFreshAuth, authLimiter, accountChangeOtpAccountLimiter, async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const result = await authService.verifyEmailChange(authUser.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/account/change-password/request", requireFreshAuth, authLimiter, accountChangeOtpAccountLimiter, async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const result = await authService.requestPasswordChange(authUser.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/account/change-password/verify", requireFreshAuth, authLimiter, accountChangeOtpAccountLimiter, async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const result = await authService.verifyPasswordChange(authUser.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/account/pin/setup", requireFreshAuth, authLimiter, accountChangeOtpAccountLimiter, async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const result = await authService.setupPin(authUser.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/account/pin/change", requireFreshAuth, authLimiter, accountChangeOtpAccountLimiter, async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const result = await authService.changePin(authUser.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/account/pin/reset/request", requireFreshAuth, authLimiter, accountChangeOtpAccountLimiter, async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const result = await authService.requestPinReset(authUser.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/account/pin/reset/verify", requireFreshAuth, authLimiter, accountChangeOtpAccountLimiter, async (req, res, next) => {
  try {
    const { authUser } = req as AuthenticatedRequest;
    const result = await authService.resetPin(authUser.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/forgot-password", authLimiter, passwordResetRequestAccountLimiter, async (req, res, next) => {
  try {
    const result = await authService.forgotPassword(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/forgot-password/otp", authLimiter, passwordResetRequestAccountLimiter, async (req, res, next) => {
  try {
    const result = await authService.requestPasswordResetOtp(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/reset-password", authLimiter, async (req, res, next) => {
  try {
    const result = await authService.resetPassword(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/reset-password/otp", authLimiter, passwordResetVerifyAccountLimiter, async (req, res, next) => {
  try {
    const result = await authService.resetPasswordWithOtp(req.body);
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
