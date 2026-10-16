import { encryptedClient } from "../privacy/encryptedClient";
import { PrismaClient } from "@prisma/client";
import { assertPrivateWrite } from "../privacy/persistenceGuard";

declare global {
  var __prisma__: ReturnType<typeof createPrivateClient> | undefined;
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

function createPrivateClient(): PrismaClient {
  const client = new PrismaClient({
    ...(databaseUrl() ? { datasources: { db: { url: databaseUrl() } } } : {}),
    // Prisma validation/query diagnostics can contain bound private values.
    log: [],
  }).$extends({
    name: "private-persistence-guard",
    query: { $allModels: {
      $allOperations({ model, operation, args, query }) {
        assertPrivateWrite(model, operation, args as { data?: unknown; create?: unknown; update?: unknown });
        return query(args);
      },
    } },
  }) as unknown as PrismaClient;
  return encryptedClient(client);
}

export const prisma = global.__prisma__ ?? createPrivateClient();
global.__prisma__ = prisma;
