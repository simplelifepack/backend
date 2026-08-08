import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { driveAuthorizeLimiter, driveScanLimiter } from "../middleware/security";
import { completeDriveAuthorization, consumeDriveOAuthState, createDriveAuthorizationUrl, DriveOAuthError, markDriveDisconnectedOnAuthFailure } from "../services/drive/oauth";
import { DRIVE_SCOPE } from "../services/drive/config";
import { hasGrantedScope } from "../services/googleIntegrationStatus";
import { scanDrive, type DriveScanResult } from "../services/drive/scanner";
import { completeOAuthPopupCallback, sendOAuthPopupCallback } from "../services/oauthPopupCallback";

const router = Router();

router.get("/callback", async (req, res) => {
  const result = await completeOAuthPopupCallback(req.query, {
    provider: "drive",
    authorize: completeDriveAuthorization,
    consumeDeniedState: consumeDriveOAuthState,
    mapError: (error) => error instanceof DriveOAuthError ? error.safeCode : "authorization_failed",
  });
  return sendOAuthPopupCallback(res, result);
});

router.use(requireAuth);

router.get("/status", async (req, res, next) => {
  try {
    const userId = (req as unknown as AuthenticatedRequest).authUser.id;
    const connection = await prisma.externalConnection.findUnique({ where: { userId_provider: { userId, provider: "google_drive" } } });
    const connected = hasGrantedScope(connection, DRIVE_SCOPE);
    const scanStatus = connection?.scanStartedAt ? "scanning" : connection?.lastScanError ? "failed" : connection?.lastScannedAt ? "completed" : "idle";
    return res.json({
      connected,
      account: connected ? connection!.providerEmail : null,
      scanStatus,
      lastScannedAt: connection?.lastScannedAt ?? null,
      lastSuccessfulSync: connection?.lastSuccessfulSync ?? null,
      scanning: Boolean(connection?.scanStartedAt),
      phase: connection?.scanPhase ?? null,
      processed: connection?.scanProcessed ?? 0,
      total: connection?.scanTotal ?? 0,
      indexedCount: connection?.indexedCount ?? 0,
      error: connection?.lastScanError ?? null,
    });
  } catch (error) { return next(error); }
});

router.post("/authorize", driveAuthorizeLimiter, async (req, res, next) => {
  try {
    const authUser = (req as unknown as AuthenticatedRequest).authUser;
    return res.json({ authorizationUrl: await createDriveAuthorizationUrl(authUser.id, authUser.email) });
  } catch (error) { return next(error); }
});

router.post("/scan", driveScanLimiter, async (req, res, next) => {
  const userId = (req as unknown as AuthenticatedRequest).authUser.id;
  try {
    const options = z.object({
      full: z.boolean().optional().default(false),
      duplicateAction: z.enum(["replace", "keep_both", "ignore"]).optional().default("ignore"),
    }).parse(req.body ?? {});
    const running = await prisma.externalConnection.findUnique({
      where: { userId_provider: { userId, provider: "google_drive" } },
      select: { scanStartedAt: true },
    });
    if (running?.scanStartedAt) return res.status(409).json({ message: "A Google Drive scan is already running." });
    const result: DriveScanResult = await scanDrive(userId, options);
    return res.json(result);
  } catch (error) {
    await markDriveDisconnectedOnAuthFailure(userId, error);
    return next(error);
  }
});

router.delete("/", driveAuthorizeLimiter, async (req, res, next) => {
  try {
    const userId = (req as unknown as AuthenticatedRequest).authUser.id;
    const connection = await prisma.externalConnection.findUnique({ where: { userId_provider: { userId, provider: "google_drive" } } });
    if (!connection) return res.status(204).send();
    if (connection.scanStartedAt) return res.status(409).json({ message: "A Google Drive scan is already running. Wait for it to finish before disconnecting." });
    await prisma.externalConnection.delete({ where: { id: connection.id } });
    return res.status(204).send();
  } catch (error) { return next(error); }
});

export default router;
