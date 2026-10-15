/**
 * Creates (or promotes) the first AdminUser so there's someone who can sign in
 * to register the very first passkey. Mirrors the existing
 * `provisionPackagesAdminFromEnv` pattern in adminPackages.service.ts.
 *
 * Usage:
 *   ADMIN_BOOTSTRAP_EMAIL=you@readines.com ADMIN_BOOTSTRAP_NAME="Your Name" \
 *     npx tsx src/scripts/bootstrapAdminUser.ts
 *
 * Role defaults to "owner" (ADMIN_BOOTSTRAP_ROLE to override). Idempotent —
 * re-running just confirms the account exists; it does not reset passkeys.
 */
import { loadBackendEnv } from "../config/env";
loadBackendEnv();

import type { AdminRole } from "@prisma/client";
import { prisma } from "../lib/prisma";

const ROLES: AdminRole[] = ["support", "catalogue", "ops_security", "owner"];

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_BOOTSTRAP_NAME?.trim();
  const role = (process.env.ADMIN_BOOTSTRAP_ROLE?.trim() || "owner") as AdminRole;

  if (!email) throw new Error("ADMIN_BOOTSTRAP_EMAIL is required.");
  if (!name) throw new Error("ADMIN_BOOTSTRAP_NAME is required.");
  if (!ROLES.includes(role)) throw new Error(`ADMIN_BOOTSTRAP_ROLE must be one of: ${ROLES.join(", ")}`);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    create: { email, name, role },
    update: { name, role, disabledAt: null },
  });

  console.log(`Admin ready: ${admin.email} (${admin.role}). Sign in with Google to register a passkey.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
