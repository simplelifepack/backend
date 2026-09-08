import type { Request, Response } from "express";

export const REFRESH_COOKIE_NAME = "readiness_refresh";
// Compatibility: rotate existing sessions into the Readiness cookie on refresh.
const LEGACY_REFRESH_COOKIE_NAME = "lifepack_refresh";
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function sameSite() {
  const configured = process.env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase();
  return configured === "strict" || configured === "none" ? configured : "lax";
}

function cookieParts(maxAge: number, name = REFRESH_COOKIE_NAME) {
  const policy = sameSite();
  const parts = [
    `${name}=`,
    "HttpOnly",
    `Path=${process.env.AUTH_COOKIE_PATH?.trim() || "/auth"}`,
    `SameSite=${policy[0]!.toUpperCase()}${policy.slice(1)}`,
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === "production" || policy === "none" || process.env.AUTH_COOKIE_SECURE === "true") parts.push("Secure");
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts;
}

export function setRefreshCookie(res: Response, refreshToken: string) {
  const parts = cookieParts(REFRESH_COOKIE_MAX_AGE_SECONDS);
  parts[0] = `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}`;
  res.append("Set-Cookie", parts.join("; "));
  res.append("Set-Cookie", cookieParts(0, LEGACY_REFRESH_COOKIE_NAME).join("; "));
}

export function clearRefreshCookie(res: Response) {
  res.append("Set-Cookie", cookieParts(0).join("; "));
  res.append("Set-Cookie", cookieParts(0, LEGACY_REFRESH_COOKIE_NAME).join("; "));
}

export function readRefreshCookie(req: Request) {
  const cookies = (req.headers.cookie ?? "").split(";");
  for (const expectedName of [REFRESH_COOKIE_NAME, LEGACY_REFRESH_COOKIE_NAME]) {
    for (const cookie of cookies) {
      const [name, ...value] = cookie.trim().split("=");
      if (name === expectedName) {
        try { return decodeURIComponent(value.join("=")); } catch { return null; }
      }
    }
  }
  return null;
}
