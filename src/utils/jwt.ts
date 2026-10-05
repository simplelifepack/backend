import jwt from "jsonwebtoken";

// Compatibility: preserve existing development sessions during the product rename.
const JWT_SECRET = process.env.JWT_SECRET || "lifepack-dev-secret";
const JWT_EXPIRES_IN = "15m";

type JwtPayload = {
  sub: string;
  email: string;
  name?: string;
  authVersion?: number;
};

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET?.trim()) throw new Error("JWT_SECRET is required in production.");

export function signAccessToken(payload: JwtPayload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, JWT_SECRET) as JwtPayload & jwt.JwtPayload;
}

export function isAccessTokenPayload(payload: unknown): payload is JwtPayload & jwt.JwtPayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<JwtPayload>;
  return typeof candidate.sub === "string"
    && candidate.sub.length > 0
    && typeof candidate.email === "string"
    && candidate.email.length > 0
    && (candidate.authVersion === undefined || typeof candidate.authVersion === "number")
    && (candidate.name === undefined || typeof candidate.name === "string");
}
