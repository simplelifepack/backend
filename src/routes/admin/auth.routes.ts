import { Router } from "express";
import { z } from "zod";

import { adminLimiter } from "../../middleware/security";
import { requireAdminAuth, type AdminAuthenticatedRequest } from "../../middleware/adminAuth";
import {
  AdminAuthError,
  beginAdminLogin,
  devLogin,
  enrollmentOptions,
  loginOptions,
  logout,
  stepUpOptions,
  verifyEnrollment,
  verifyLogin,
  verifyStepUp,
} from "../../services/adminAuth.service";

const router = Router();

function reqMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined };
}

const pendingSchema = z.object({ pendingToken: z.string().min(1) });

// adminLimiter (10 req / 15 min by default) is reserved for the actual
// credential-proving steps — the things worth throttling against brute force
// or credential stuffing. It is applied per-route below, never to the whole
// router: a blanket router.use(adminLimiter) previously counted every GET
// /me session check (fired on every page load) against the same tiny budget
// as login attempts, so reloading the page a few times locked you out for the
// full window. Read-only / already-authenticated routes rely on the general
// API limiter mounted globally in app.ts instead.

router.post("/google", adminLimiter, async (req, res, next) => {
  try {
    const result = await beginAdminLogin(req.body);
    return res.json(result);
  } catch (error) {
    if (error instanceof AdminAuthError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.post("/passkey/enroll/options", async (req, res, next) => {
  try {
    const { pendingToken } = pendingSchema.parse(req.body);
    return res.json(await enrollmentOptions(pendingToken));
  } catch (error) {
    if (error instanceof AdminAuthError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.post("/passkey/enroll/verify", adminLimiter, async (req, res, next) => {
  try {
    const { pendingToken, response, deviceLabel } = req.body ?? {};
    const parsed = pendingSchema.parse({ pendingToken });
    const result = await verifyEnrollment(parsed.pendingToken, response, deviceLabel, reqMeta(req));
    return res.json(result);
  } catch (error) {
    if (error instanceof AdminAuthError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.post("/passkey/login/options", async (req, res, next) => {
  try {
    const { pendingToken } = pendingSchema.parse(req.body);
    return res.json(await loginOptions(pendingToken));
  } catch (error) {
    if (error instanceof AdminAuthError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.post("/passkey/login/verify", adminLimiter, async (req, res, next) => {
  try {
    const { pendingToken, response } = req.body ?? {};
    const parsed = pendingSchema.parse({ pendingToken });
    const result = await verifyLogin(parsed.pendingToken, response, reqMeta(req));
    return res.json(result);
  } catch (error) {
    if (error instanceof AdminAuthError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

// "Test as Admin" — skips Google + passkey. Google sign-in above is untouched
// per 12 Oct instruction; this is a second, separate door that does not exist
// in production (checked here and again in the service, since this is the one
// route on this surface it would actually be bad to get wrong).
router.post("/dev-login", adminLimiter, async (req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ message: "Not available in production." });
  }
  try {
    const result = await devLogin(req.body?.role, reqMeta(req));
    return res.json(result);
  } catch (error) {
    if (error instanceof AdminAuthError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.get("/me", requireAdminAuth, (req, res) => {
  const { adminUser, adminSession } = req as AdminAuthenticatedRequest;
  return res.json({ admin: adminUser, session: adminSession });
});

router.post("/step-up/options", requireAdminAuth, async (req, res, next) => {
  try {
    const { adminUser } = req as AdminAuthenticatedRequest;
    return res.json(await stepUpOptions(adminUser.id));
  } catch (error) {
    if (error instanceof AdminAuthError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.post("/step-up/verify", requireAdminAuth, adminLimiter, async (req, res, next) => {
  try {
    const { adminUser, adminSession } = req as AdminAuthenticatedRequest;
    const result = await verifyStepUp(adminUser.id, adminSession.id, req.body?.response);
    return res.json(result);
  } catch (error) {
    if (error instanceof AdminAuthError) return res.status(error.statusCode).json({ message: error.message });
    return next(error);
  }
});

router.post("/logout", requireAdminAuth, async (req, res, next) => {
  try {
    const { adminUser, adminSession } = req as AdminAuthenticatedRequest;
    await logout(adminUser.id, adminSession.id);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
