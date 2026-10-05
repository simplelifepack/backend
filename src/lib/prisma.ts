import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma__: PrismaClient | undefined;
}

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value || process.env.PRISMA_DISABLE_SERVERLESS_POOL_LIMIT === "1") return value;
  if (!process.env.VERCEL && process.env.NODE_ENV !== "production") return value;
  try {
    const url = new URL(value);
    if (!url.protocol.startsWith("postgres")) return value;
    url.searchParams.set("connection_limit", "1");
    return url.toString();
  } catch {
    return value;
  }
}

export const prisma =
  global.__prisma__ ??
  new PrismaClient({
    ...(databaseUrl() ? { datasources: { db: { url: databaseUrl() } } } : {}),
    log: ["error", "warn"],
  });

global.__prisma__ = prisma;
