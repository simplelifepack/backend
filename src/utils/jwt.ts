import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";

// Compatibility: preserve existing development sessions during the product rename.
const JWT_SECRET = process.env.JWT_SECRET || "lifepack-dev-secret";
const JWT_ISSUER = "readines-backend";
const JWT_AUDIENCE = "readines-clients";
const JWT_EXPIRES_IN = (process.env.ACCESS_TOKEN_TTL?.trim() || "5m") as SignOptions["expiresIn"];

type JwtPayload = {
  sub: string;
  sid?: string;
  email?: string;
  name?: string;
  authVersion?: number;
};

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET?.trim()) throw new Error("JWT_SECRET is required in production.");

export function signAccessToken(payload: JwtPayload) {
  const minimal = { sub: payload.sub, ...(payload.sid ? { sid: payload.sid } : {}), authVersion: payload.authVersion ?? 0 };
  return jwt.sign(minimal, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
  if (typeof payload === "string" || typeof payload.exp !== "number") throw new jwt.JsonWebTokenError("Access token expiry is required.");
  return payload as JwtPayload & jwt.JwtPayload;
}

export function isAccessTokenPayload(payload: unknown): payload is JwtPayload & jwt.JwtPayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<JwtPayload>;
  return typeof candidate.sub === "string"
    && candidate.sub.length > 0
    && (candidate.sid === undefined || typeof candidate.sid === "string" && candidate.sid.length > 0)
    && (candidate.authVersion === undefined || Number.isSafeInteger(candidate.authVersion) && (candidate.authVersion ?? -1) >= 0)
    && (candidate.name === undefined || typeof candidate.name === "string");
}
