import { PostgresRateLimitStore } from "./postgresRateLimitStore";
import { allowedBrowserOrigins } from "./domainAccess";
import type { CorsOptions } from "cors";
import type { Request, Response, NextFunction } from "express";
import { privateLookup } from "../privacy/fieldEncryption";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { HelmetOptions } from "helmet";

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clientRateLimitKey(req: Request) {
  // Express resolves trusted proxies; never trust arbitrary Forwarded headers.
  return ipKeyGenerator(req.ip || "unknown");
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hashRateLimitKey(scope: string, value: string) {
  return privateLookup(value, { model: "RateLimit", field: scope, ownerId: "server" });
}

function emailRateLimitKey(req: Request) {
  const email = normalizeEmail((req.body as { email?: unknown } | undefined)?.email);
  return email ? hashRateLimitKey("email", email) : hashRateLimitKey("ip-fallback", clientRateLimitKey(req));
}

function authenticatedAccountRateLimitKey(req: Request) {
  const userId = (req as { authUser?: { id?: unknown } }).authUser?.id;
  return typeof userId === "string" && userId ? hashRateLimitKey("account", userId) : hashRateLimitKey("ip-fallback", clientRateLimitKey(req));
}

function buildRateLimiter(input: {
  scope: string;
  windowMinutes: number;
  max: number;
  message: string;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
}) {
  return rateLimit({
    windowMs: input.windowMinutes * 60 * 1000,
    max: input.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: input.keyGenerator ?? clientRateLimitKey,
    // Shared security counters include successes; late responses cannot decrement
    // a newer window and weaken brute-force protection.
    skipSuccessfulRequests: false,
    store: new PostgresRateLimitStore(input.scope, input.windowMinutes * 60 * 1000),
    message: {
      message: input.message,
    },
  });
}

export const securityHeadersOptions: HelmetOptions = {
  crossOriginResourcePolicy: false,
};

export const corsOptions: CorsOptions = {
  credentials: true,
  exposedHeaders: ["Content-Disposition", "Content-Length"],
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedBrowserOrigins().has(origin)) return callback(null, true);

    return callback(new Error("Origin is not allowed by CORS."));
  },
};

export const jsonBodyLimit = process.env.JSON_BODY_LIMIT ?? "1mb";

export const generalApiLimiter = buildRateLimiter({
  scope: "generalApiLimiter",
  windowMinutes: numberFromEnv("RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("RATE_LIMIT_MAX", 300),
  message: "Too many requests. Please try again later.",
});

export const authLimiter = buildRateLimiter({
  scope: "authLimiter",
  windowMinutes: numberFromEnv("AUTH_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("AUTH_RATE_LIMIT_MAX", 20),
  message: "Too many authentication attempts. Please try again later.",
});

export const loginAccountLimiter = buildRateLimiter({
  scope: "loginAccountLimiter",
  windowMinutes: numberFromEnv("AUTH_ACCOUNT_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("LOGIN_ACCOUNT_RATE_LIMIT_MAX", 10),
  message: "Too many authentication attempts. Please try again later.",
  keyGenerator: emailRateLimitKey,
  skipSuccessfulRequests: true,
});

export const signupOtpRequestAccountLimiter = buildRateLimiter({
  scope: "signupOtpRequestAccountLimiter",
  windowMinutes: numberFromEnv("SIGNUP_OTP_ACCOUNT_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("SIGNUP_OTP_ACCOUNT_RATE_LIMIT_MAX", 5),
  message: "Too many authentication attempts. Please try again later.",
  keyGenerator: emailRateLimitKey,
});

export const signupOtpVerifyAccountLimiter = buildRateLimiter({
  scope: "signupOtpVerifyAccountLimiter",
  windowMinutes: numberFromEnv("SIGNUP_OTP_VERIFY_ACCOUNT_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("SIGNUP_OTP_VERIFY_ACCOUNT_RATE_LIMIT_MAX", 10),
  message: "Invalid or expired signup code.",
  keyGenerator: emailRateLimitKey,
});

export const passwordResetRequestAccountLimiter = buildRateLimiter({
  scope: "passwordResetRequestAccountLimiter",
  windowMinutes: numberFromEnv("PASSWORD_RESET_ACCOUNT_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("PASSWORD_RESET_ACCOUNT_RATE_LIMIT_MAX", 5),
  message: "If an account exists for that email, a password reset code will be sent.",
  keyGenerator: emailRateLimitKey,
});

export const passwordResetVerifyAccountLimiter = buildRateLimiter({
  scope: "passwordResetVerifyAccountLimiter",
  windowMinutes: numberFromEnv("PASSWORD_RESET_VERIFY_ACCOUNT_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("PASSWORD_RESET_VERIFY_ACCOUNT_RATE_LIMIT_MAX", 10),
  message: "Invalid or expired password reset code.",
  keyGenerator: emailRateLimitKey,
});

export const accountChangeOtpAccountLimiter = buildRateLimiter({
  scope: "accountChangeOtpAccountLimiter",
  windowMinutes: numberFromEnv("ACCOUNT_CHANGE_OTP_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("ACCOUNT_CHANGE_OTP_RATE_LIMIT_MAX", 8),
  message: "Too many authentication attempts. Please try again later.",
  keyGenerator: authenticatedAccountRateLimitKey,
});

export const tokenRefreshLimiter = buildRateLimiter({
  scope: "tokenRefreshLimiter",
  windowMinutes: numberFromEnv("REFRESH_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("REFRESH_RATE_LIMIT_MAX", 60),
  message: "Too many session refresh attempts. Please sign in again later.",
});

export const uploadLimiter = buildRateLimiter({
  scope: "uploadLimiter",
  windowMinutes: numberFromEnv("UPLOAD_RATE_LIMIT_WINDOW_MINUTES", 60),
  max: numberFromEnv("UPLOAD_RATE_LIMIT_MAX", 30),
  message: "Too many document uploads. Please try again later.",
});

export const adminLimiter = buildRateLimiter({
  scope: "adminLimiter",
  windowMinutes: numberFromEnv("ADMIN_RATE_LIMIT_WINDOW_MINUTES", 15),
  max: numberFromEnv("ADMIN_RATE_LIMIT_MAX", 10),
  message: "Too many admin requests. Please try again later.",
});

export const gmailAuthorizeLimiter = buildRateLimiter({
  scope: "gmailAuthorizeLimiter",
  windowMinutes: 15,
  max: 10,
  message: "Too many Gmail connection attempts. Please try again later.",
});

export const gmailScanLimiter = buildRateLimiter({
  scope: "gmailScanLimiter",
  windowMinutes: 60,
  max: 6,
  message: "Too many Gmail scans. Please try again later.",
});

export const gmailImportLimiter = buildRateLimiter({
  scope: "gmailImportLimiter",
  windowMinutes: 60,
  max: 30,
  message: "Too many Gmail imports. Please try again later.",
});

export const driveAuthorizeLimiter = buildRateLimiter({
  scope: "driveAuthorizeLimiter",
  windowMinutes: 15,
  max: 10,
  message: "Too many Google Drive connection attempts. Please try again later.",
});

export const driveScanLimiter = buildRateLimiter({
  scope: "driveScanLimiter",
  windowMinutes: 60,
  max: 6,
  message: "Too many Google Drive scans. Please try again later.",
});

export function requireAdminSeedToken(req: Request, res: Response, next: NextFunction) {
  const configuredToken = process.env.ADMIN_SEED_TOKEN?.trim();

  const providedToken = req.header("x-admin-seed-token")?.trim();
  if (configuredToken && providedToken === configuredToken) return next();

  return res.status(403).json({
    message: "Admin seed access denied.",
  });
}
