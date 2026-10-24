import type { RequestHandler } from "express";

export const productionOrigins = ["https://readines.com", "https://www.readines.com"];
export function allowedBrowserOrigins() {
  return new Set([
    ...productionOrigins,
    "https://frontend-web-nine-amber.vercel.app",
    "http://localhost:5173",
    ...["CORS_ORIGINS", "CORS_LOCALHOST_ORIGINS", "CORS_PREVIEW_ORIGINS"].flatMap(name => (process.env[name] ?? "").split(",").map(value => value.trim()).filter(Boolean)),
  ]);
}

// Origin is a browser policy signal, never an identity or authorization claim.
// No-Origin server/mobile/webhook requests retain all existing auth requirements.
export const productionDomainAccess: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  const publicWaitlist = (req.method === "GET" && req.path === "/api/waitlist/challenge") ||
    (req.method === "POST" && ["/api/waitlist/register", "/api/waitlist/unsubscribe"].includes(req.path));
  if (origin && productionOrigins.includes(origin) && !publicWaitlist) {
    return res.status(403).json({ message: "Only early access registration is available on this domain." });
  }
  next();
};
