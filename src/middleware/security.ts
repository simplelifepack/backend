import type { CorsOptions } from "cors";
import type { Request, Response, NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { HelmetOptions } from "helmet";

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function csvFromEnv(name: string) {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function clientRateLimitKey(req: Request) {
  // Express resolves trusted proxies; never trust arbitrary Forwarded headers.
  return ipKeyGenerator(req.ip || "unknown");
}

function buildRateLimiter(input: {
  windowMinutes: number;
  max: number;
  message: string;
}) {
  return rateLimit({
    windowMs: input.windowMinutes * 60 * 1000,
    max: input.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientRateLimitKey,
    message: {
      message: input.message,
    },
  });
}

function isAllowedLocalhostOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
      Boolean(parsed.port);
  } catch {
    return false;
  }
}

export const securityHeadersOptions: HelmetOptions = {
  crossOriginResourcePolicy: false,
};

export const corsOptions: CorsOptions = {
  credentials: true,
  exposedHeaders: ["Content-Disposition", "Content-Length"],
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const allowedOrigins = csvFromEnv("CORS_ORIGINS");

    if (allowedOrigins.includes(origin) || (process.env.NODE_ENV !== "production" && isAllowedLocalhostOrigin(origin))) return callback(null, true);

    return callback(new Error("Origin is not allowed by CORS."));
  },
};

export const jsonBodyLimit = process.env.JSON_BODY_LIMIT ?? "1mb";

export const generalApiLimiter = buildRateLimiter({
  windowMinutes: numberFromEnv("RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("RATE_LIMIT_MAX", 300),
  message: "Too many requests. Please try again later.",
});

export const authLimiter = buildRateLimiter({
  windowMinutes: numberFromEnv("AUTH_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("AUTH_RATE_LIMIT_MAX", 20),
  message: "Too many authentication attempts. Please try again later.",
});

export const tokenRefreshLimiter = buildRateLimiter({
  windowMinutes: numberFromEnv("REFRESH_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("REFRESH_RATE_LIMIT_MAX", 60),
  message: "Too many session refresh attempts. Please sign in again later.",
});

export const uploadLimiter = buildRateLimiter({
  windowMinutes: numberFromEnv("UPLOAD_RATE_LIMIT_WINDOW_MINUTES", 60),
  max: numberFromEnv("UPLOAD_RATE_LIMIT_MAX", 30),
  message: "Too many document uploads. Please try again later.",
});

export const adminLimiter = buildRateLimiter({
  windowMinutes: numberFromEnv("ADMIN_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("ADMIN_RATE_LIMIT_MAX", 10),
  message: "Too many admin requests. Please try again later.",
});

export const gmailAuthorizeLimiter = buildRateLimiter({
  windowMinutes: 15,
  max: 10,
  message: "Too many Gmail connection attempts. Please try again later.",
});

export const gmailScanLimiter = buildRateLimiter({
  windowMinutes: 60,
  max: 6,
  message: "Too many Gmail scans. Please try again later.",
});

export const gmailImportLimiter = buildRateLimiter({
  windowMinutes: 60,
  max: 30,
  message: "Too many Gmail imports. Please try again later.",
});

export const driveAuthorizeLimiter = buildRateLimiter({
  windowMinutes: 15,
  max: 10,
  message: "Too many Google Drive connection attempts. Please try again later.",
});

export const driveScanLimiter = buildRateLimiter({
  windowMinutes: 60,
  max: 6,
  message: "Too many Google Drive scans. Please try again later.",
});

export function requireAdminSeedToken(req: Request, res: Response, next: NextFunction) {
  const configuredToken = process.env.ADMIN_SEED_TOKEN?.trim();
  if (!configuredToken && process.env.NODE_ENV !== "production") return next();

  const providedToken = req.header("x-admin-seed-token")?.trim();
  if (configuredToken && providedToken === configuredToken) return next();

  return res.status(403).json({
    message: "Admin seed access denied.",
  });
}
