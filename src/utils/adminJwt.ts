import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";

import type { AdminRole } from "@prisma/client";

// Decision D2: a user token must never be able to pass an admin check, so this
// uses its own secret and its own audience claim — never the customer JWT_SECRET.
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "readiness-admin-dev-secret";
const ADMIN_JWT_AUDIENCE = "admin";
const ADMIN_JWT_EXPIRES_IN = (process.env.ADMIN_ACCESS_TOKEN_TTL?.trim() || "15m") as SignOptions["expiresIn"];

if (process.env.NODE_ENV === "production" && !process.env.ADMIN_JWT_SECRET?.trim()) {
  throw new Error("ADMIN_JWT_SECRET is required in production.");
}
if (process.env.NODE_ENV === "production" && process.env.ADMIN_JWT_SECRET === process.env.JWT_SECRET) {
  throw new Error("ADMIN_JWT_SECRET must differ from JWT_SECRET — a leaked customer token must never pass an admin check.");
}

export type AdminJwtPayload = {
  sub: string; // AdminUser.id
  email: string;
  role: AdminRole;
  sessionId: string;
  authVersion: number;
  aud: typeof ADMIN_JWT_AUDIENCE;
};

export function signAdminToken(payload: Omit<AdminJwtPayload, "aud">) {
  return jwt.sign(payload, ADMIN_JWT_SECRET, {
    expiresIn: ADMIN_JWT_EXPIRES_IN,
    audience: ADMIN_JWT_AUDIENCE,
  });
}

export function verifyAdminToken(token: string) {
  return jwt.verify(token, ADMIN_JWT_SECRET, { audience: ADMIN_JWT_AUDIENCE }) as AdminJwtPayload & jwt.JwtPayload;
}

export function isAdminTokenPayload(payload: unknown): payload is AdminJwtPayload & jwt.JwtPayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<AdminJwtPayload>;
  return typeof candidate.sub === "string" && candidate.sub.length > 0
    && typeof candidate.email === "string" && candidate.email.length > 0
    && typeof candidate.sessionId === "string" && candidate.sessionId.length > 0
    && typeof candidate.role === "string"
    && typeof candidate.authVersion === "number";
}

// A separate, narrow, short-lived token for the gap between "Google identity
// verified" and "passkey ceremony complete." Signed with the same secret but a
// different audience, so it can never be mistaken for a real session by
// requireAdminAuth (which pins aud:"admin") even if it leaked.
const PENDING_AUDIENCE = "admin-pending";

export type AdminPendingPayload = { adminId: string; purpose: "enroll" | "login" };

export function signAdminPendingToken(payload: AdminPendingPayload) {
  return jwt.sign(payload, ADMIN_JWT_SECRET, { expiresIn: "5m", audience: PENDING_AUDIENCE });
}

export function verifyAdminPendingToken(token: string) {
  return jwt.verify(token, ADMIN_JWT_SECRET, { audience: PENDING_AUDIENCE }) as AdminPendingPayload & jwt.JwtPayload;
}
