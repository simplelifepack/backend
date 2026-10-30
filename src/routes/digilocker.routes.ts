import { waitUntil } from "@vercel/functions";
import { authorizedWorker } from "../services/digilocker/workerAuthorization";
import { createAdmissionLimit } from "../middleware/resourceLimits";
import { drainDigiLockerQueue } from "../services/digilocker/worker";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { uploadLimiter } from "../middleware/security";
import { cleanupExpiredDigiLockerCredentials, cancelDigiLockerSession, completeDigiLockerAuthorization, digilockerStatus, importDigiLockerDocuments, listDigiLockerDocuments, refreshDigiLockerSession, startDigiLockerSession } from "../services/digilocker/digilocker.service";
import { digiLockerReturnUrl } from "../services/digilocker/returnTarget";
const router = Router();
router.use(async (_req, res, next) => {
  try { await cleanupExpiredDigiLockerCredentials(); } catch (error) { return next(error); }
  res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); next(); });
// OAuth callback is public; one-time state resolves the owner before any private read.
router.get("/callback", async (req, res) => {
  const target = new URL("/documents", process.env.FRONTEND_URL ?? "http://localhost:5173");
  try {
    const query = z.object({ state: z.string().min(32).max(256), code: z.string().min(1).max(4096).optional(), error: z.string().max(256).optional() }).parse(req.query);
    const result = await completeDigiLockerAuthorization({ state: query.state, code: query.code, denied: Boolean(query.error) });
    return res.redirect(303, digiLockerReturnUrl(result));
  } catch { target.hash = "digilocker_error=invalid_state"; }
  return res.redirect(303, target.toString());
});
// A scheduler is the recovery path when a function or host disappears.
router.get("/worker", async (req, res, next) => {
  if (!authorizedWorker(req.get("authorization"))) return res.sendStatus(401);
  try { await drainDigiLockerQueue(); res.json({ ok: true }); } catch (error) { next(error); }
});
router.use(requireAuth);
const userId = (req: unknown) => (req as AuthenticatedRequest).authUser.id;
router.get("/status", (_req, res) => res.json(digilockerStatus()));
router.post("/sessions", uploadLimiter, async (req, res, next) => {
  try { const payload = z.object({ redirectUrl: z.string().optional(), returnFormat: z.literal("session-v1").optional() }).strict().parse(req.body ?? {}); res.status(201).json(await startDigiLockerSession({ userId: userId(req), ...payload })); }
  catch (error) { next(error); }
});
router.get("/sessions/:id/status", async (req, res, next) => {
  try { res.json(await refreshDigiLockerSession(userId(req), z.string().parse(req.params.id), process.env.VERCEL ? () => waitUntil(drainDigiLockerQueue().catch(() => console.error({ event: "digilocker_worker_failed" }))) : undefined)); } catch (error) { next(error); }
});
router.post("/sessions/:id/cancel", async (req, res, next) => {
  try { res.json(await cancelDigiLockerSession(userId(req), z.string().parse(req.params.id))); } catch (error) { next(error); }
});
router.get("/sessions/:id/documents", async (req, res, next) => {
  try { res.json(await listDigiLockerDocuments(userId(req), z.string().parse(req.params.id))); } catch (error) { next(error); }
});
const importSchema = z.object({ references: z.array(z.string().min(1).max(1024)).min(1).max(50), consent: z.literal(true), consentVersion: z.literal("digilocker-copy-v1") }).strict();
router.post("/sessions/:id/import", uploadLimiter, createAdmissionLimit(3), async (req, res, next) => {
  try {
    const payload = importSchema.parse(req.body);
    const queued = await importDigiLockerDocuments({ userId: userId(req), sessionId: z.string().parse(req.params.id), ...payload });
    if (process.env.VERCEL) waitUntil(drainDigiLockerQueue().catch(() => console.error({ event: "digilocker_worker_failed" })));
    res.status(202).json(queued);
  }
  catch (error) { next(error); }
});
export default router;
