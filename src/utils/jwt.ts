import jwt from "jsonwebtoken";

// Compatibility: preserve existing development sessions during the product rename.
const JWT_SECRET = process.env.JWT_SECRET || "lifepack-dev-secret";
const JWT_EXPIRES_IN = "15m";

type JwtPayload = {
  sub: string;
  email: string;
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
