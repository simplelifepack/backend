import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

test("bootstrap consumes its environment secret and existing admins require explicit rotation", async () => {
  let existing = false;
  let writes = 0;
  global.__prisma__ = { user: {
    findUnique: async () => existing ? { id: "admin" } : null,
    upsert: async (args: { create: { passwordHash: string }; update: { authVersion?: unknown } }) => {
      writes++; assert(await bcrypt.compare("Generated-Test-Password-123!", args.create.passwordHash));
      assert.equal(existing ? !!args.update.authVersion : Object.keys(args.update).length === 0, true);
      return { id: "admin" };
    },
  } } as unknown as PrismaClient;
  const { provisionPackagesAdminFromEnv } = await import("./adminBootstrap");
  process.env.PACKAGES_ADMIN_INITIAL_PASSWORD = "short";
  await assert.rejects(provisionPackagesAdminFromEnv(), /16 characters/);
  assert.equal(process.env.PACKAGES_ADMIN_INITIAL_PASSWORD, undefined);
  process.env.PACKAGES_ADMIN_INITIAL_PASSWORD = "Generated-Test-Password-123!";
  await provisionPackagesAdminFromEnv(); assert.equal(writes, 1);
  existing = true;
  process.env.PACKAGES_ADMIN_INITIAL_PASSWORD = "Generated-Test-Password-123!";
  await assert.rejects(provisionPackagesAdminFromEnv(), /--rotate-password/); assert.equal(writes, 1);
  process.env.PACKAGES_ADMIN_INITIAL_PASSWORD = "Generated-Test-Password-123!";
  await provisionPackagesAdminFromEnv({ rotateExisting: true }); assert.equal(writes, 2);
  assert.equal(process.env.PACKAGES_ADMIN_INITIAL_PASSWORD, undefined);
});
