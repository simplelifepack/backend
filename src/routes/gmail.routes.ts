import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { gmailAuthorizeLimiter, gmailImportLimiter, gmailScanLimiter } from "../middleware/security";
import { completeAuthorization, consumeOAuthState, createAuthorizationUrl, GmailOAuthError, markGmailDisconnectedOnAuthFailure } from "../services/gmail/oauth";
import { GMAIL_SCOPE } from "../services/gmail/config";
import { hasGrantedScope } from "../services/googleIntegrationStatus";
import { scanGmail } from "../services/gmail/scanner";
import { importGmailCandidates } from "../services/gmail/importer";
import { completeOAuthPopupCallback, sendOAuthPopupCallback } from "../services/oauthPopupCallback";

const router = Router();
const activeGmailScans = new Map<string, ReturnType<typeof scanGmail>>();

router.get("/callback", async (req, res) => {
  const result = await completeOAuthPopupCallback(req.query, {
    provider: "gmail",
    authorize: completeAuthorization,
    consumeDeniedState: consumeOAuthState,
    mapError: (error) => error instanceof GmailOAuthError ? error.safeCode : "authorization_failed",
  });
  return sendOAuthPopupCallback(res, result);
});

router.use(requireAuth);

router.get("/status", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const connection = await prisma.externalConnection.findUnique({ where: { userId_provider: { userId: authUser.id, provider: "gmail" } } });
    const connected = hasGrantedScope(connection, GMAIL_SCOPE);
    return res.json({ connected, account: connected ? connection!.providerEmail : null, lastScannedAt: connection?.lastScannedAt ?? null, scanning: Boolean(connection?.scanStartedAt) });
  } catch (error) { return next(error); }
});

router.post("/authorize", gmailAuthorizeLimiter, async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    return res.json({ authorizationUrl: await createAuthorizationUrl(authUser.id) });
  } catch (error) { return next(error); }
});

router.post("/scan", gmailScanLimiter, async (req, res, next) => {
  const userId = (req as unknown as AuthenticatedRequest).authUser.id;
  try {
    const { full } = z.object({ full: z.boolean().optional().default(false) }).parse(req.body ?? {});
    let running = activeGmailScans.get(userId);
    if (!running) {
      running = scanGmail(userId, undefined, full);
      activeGmailScans.set(userId, running);
      void running.finally(() => {
        if (activeGmailScans.get(userId) === running) activeGmailScans.delete(userId);
      }).catch(() => undefined);
    }
    return res.json(await running);
  }
  catch (error) { await markGmailDisconnectedOnAuthFailure(userId, error); return next(error); }
});

router.get("/candidates", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const candidates = await prisma.externalDocumentCandidate.findMany({
      where: { userId: authUser.id, provider: "gmail" }, orderBy: [{ relevanceScore: "desc" }, { receivedAt: "desc" }], take: 500,
    });
    return res.json({ candidates });
  } catch (error) { return next(error); }
});

router.post("/candidates/:id/dismiss", async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const changed = await prisma.externalDocumentCandidate.updateMany({ where: { id: req.params.id, userId: authUser.id }, data: { status: "dismissed", ignoredReason: "Dismissed by user" } });
    return changed.count ? res.status(204).send() : res.status(404).json({ message: "Candidate not found." });
  } catch (error) { return next(error); }
});

router.post("/import", gmailImportLimiter, async (req, res, next) => {
  const userId = (req as unknown as AuthenticatedRequest).authUser.id;
  try {
    const { candidateIds } = z.object({ candidateIds: z.array(z.string().min(1)).min(1).max(25) }).parse(req.body);
    return res.json({ results: await importGmailCandidates(userId, candidateIds) });
  } catch (error) { await markGmailDisconnectedOnAuthFailure(userId, error); return next(error); }
});

router.delete("/", gmailAuthorizeLimiter, async (req, res, next) => {
  try {
    const { authUser } = req as unknown as AuthenticatedRequest;
    const connection = await prisma.externalConnection.findUnique({ where: { userId_provider: { userId: authUser.id, provider: "gmail" } } });
    if (!connection) return res.status(204).send();
    await prisma.externalDocumentCandidate.deleteMany({ where: { connectionId: connection.id, status: { not: "imported" } } });
    await prisma.externalConnection.delete({ where: { id: connection.id } });
    return res.status(204).send();
  } catch (error) { return next(error); }
});

export default router;
