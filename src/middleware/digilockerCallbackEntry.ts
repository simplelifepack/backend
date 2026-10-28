import type { RequestHandler } from "express";

// DigiLocker registered this exact backend root (including trailing slash).
// Keep ordinary root requests untouched and use the same one-time state/PKCE
// handler as the dedicated callback endpoint. Never accept a redirect target.
export const digiLockerCallbackEntry: RequestHandler = (req, res, next) => {
  if (req.method !== "GET" || req.path !== "/" || !("code" in req.query || "error" in req.query)) return next();
  const query = new URLSearchParams();
  for (const key of ["state", "code", "error"]) {
    const values = req.query[key];
    for (const value of Array.isArray(values) ? values : [values]) {
      if (typeof value === "string") query.append(key, value);
    }
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.redirect(303, `/api/integrations/digilocker/callback?${query.toString()}`);
};
