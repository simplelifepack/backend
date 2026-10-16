import type { PrismaClient } from "@prisma/client";
// Unit tests replace the database boundary, not methods inside the encrypting
// facade. Real encryption/transaction behavior is covered by PostgreSQL suites.
const unexpected = async () => { throw new Error("Unexpected test database call."); };
export const prisma = {
  user: { findUnique: unexpected },
  readinessPack: { findUnique: unexpected, findFirst: unexpected, count: unexpected },
  requirementAssignment: { findMany: unexpected },
  $transaction: unexpected,
} as unknown as PrismaClient;
global.__prisma__ = prisma;
