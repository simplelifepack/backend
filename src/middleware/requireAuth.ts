import { withPrivateUser } from "../privacy/access";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { performance } from "node:perf_hooks";

import { getUserById } from "../services/auth.service";
import { getNotedAuthVersion } from "../services/authRevocationCache";
import { isAccessTokenPayload, verifyAccessToken } from "../utils/jwt";

export type AuthTiming = {
  authMs?: number;
  jwtMs?: number;
  requestStartMs: number;
  authDbLookups?: number;
  authDbError?: string;
  userLookupMs?: number;
};

export type AuthenticatedRequest = Request & {
  authUser: {
    id: string;
    name: string;
    email: string;
    pinConfigured?: boolean;
  };
  authTiming?: AuthTiming;
};

function isDatabaseConnectionError(error: unknown) {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /emaxconn|max client connections|too many connections|connection.*(?:closed|failed|timeout|terminated)|pool/i.test(message);
}

function attachTiming(req: Request, res: Response, authTiming: AuthTiming | undefined, requestStartMs: number) {
  if (!authTiming) return;
  authTiming.authMs = performance.now() - requestStartMs;
  (req as AuthenticatedRequest).authTiming = authTiming;
  res.setHeader("X-Readiness-Auth-Timing", Buffer.from(JSON.stringify(authTiming)).toString("base64url"));
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "private, no-store");
  const timingEnabled = req.get("x-readiness-timing") === "1";
  const requestStartMs = performance.now();
  const authTiming: AuthTiming | undefined = timingEnabled ? { requestStartMs, authDbLookups: 0 } : undefined;
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Unauthorized.",
    });
  }

  const token = authHeader.slice("Bearer ".length).trim();

  try {
    const jwtStartMs = performance.now();
    const payload = verifyAccessToken(token);
    if (authTiming) authTiming.jwtMs = performance.now() - jwtStartMs;
    if (!isAccessTokenPayload(payload)) {
      return res.status(401).json({
        message: "Unauthorized.",
      });
    }

    const revokedAuthVersion = getNotedAuthVersion(payload.sub);
    if (revokedAuthVersion !== null && (payload.authVersion ?? 0) < revokedAuthVersion) return res.status(401).json({ message: "Unauthorized." });
    // SQL checks revocation version before the facade can decrypt a profile.
    const user = await withPrivateUser(payload.sub, () => getUserById(payload.sub, payload.authVersion ?? 0));
    if (!user) return res.status(401).json({ message: "Unauthorized." });
    const authUser = user;
    if (authTiming) authTiming.authDbLookups = 1;

    (req as AuthenticatedRequest).authUser = authUser;
    attachTiming(req, res, authTiming, requestStartMs);
    return withPrivateUser(authUser.id, next);
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      if (authTiming) {
        authTiming.authDbError = "connection";
        attachTiming(req, res, authTiming, requestStartMs);
      }
      console.error({
        event: "auth_database_unavailable",
        reason: "connection",
      });
      return res.status(503).json({
        message: "Authentication service temporarily unavailable.",
      });
    }
    return res.status(401).json({
      message: "Unauthorized.",
    });
  }
}

export async function requireFreshAuth(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "private, no-store");
  const timingEnabled = req.get("x-readiness-timing") === "1";
  const requestStartMs = performance.now();
  const authTiming: AuthTiming | undefined = timingEnabled ? { requestStartMs, authDbLookups: 0 } : undefined;
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  try {
    const jwtStartMs = performance.now();
    const payload = verifyAccessToken(authHeader.slice("Bearer ".length).trim());
    if (authTiming) authTiming.jwtMs = performance.now() - jwtStartMs;
    if (!isAccessTokenPayload(payload)) return res.status(401).json({ message: "Unauthorized." });

    const userLookupStartMs = performance.now();
    if (authTiming) authTiming.authDbLookups = 1;
    const user = await withPrivateUser(payload.sub, () => getUserById(payload.sub, payload.authVersion ?? 0));
    if (authTiming) authTiming.userLookupMs = performance.now() - userLookupStartMs;

    if (!user || (payload.authVersion ?? 0) !== (user.authVersion ?? 0)) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    (req as AuthenticatedRequest).authUser = user;
    attachTiming(req, res, authTiming, requestStartMs);
    return withPrivateUser(user.id, next);
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      if (authTiming) {
        authTiming.authDbError = "connection";
        attachTiming(req, res, authTiming, requestStartMs);
      }
      console.error({
        event: "auth_database_unavailable",
        reason: "connection",
      });
      return res.status(503).json({ message: "Authentication service temporarily unavailable." });
    }
    return res.status(401).json({ message: "Unauthorized." });
  }
}
