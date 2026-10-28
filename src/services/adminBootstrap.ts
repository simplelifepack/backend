import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { withCredentialLookup, withPrivateUser } from "../privacy/access";

export const PACKAGES_ADMIN_EMAIL = "admin@readines.com";
// Offline command only. Re-running bootstrap must never silently rotate an
// existing administrator's password from a long-lived deployment variable.
export async function provisionPackagesAdminFromEnv(options: { rotateExisting?: boolean } = {}) {
  const password = process.env.PACKAGES_ADMIN_INITIAL_PASSWORD;
  delete process.env.PACKAGES_ADMIN_INITIAL_PASSWORD;
  if (!password) throw new Error("PACKAGES_ADMIN_INITIAL_PASSWORD is required for this invocation.");
  if (password.length < 16 || Buffer.byteLength(password, "utf8") > 72) throw new Error("Use a generated admin password of at least 16 characters and at most 72 UTF-8 bytes.");
  const existing = await withCredentialLookup(() => prisma.user.findUnique({ where: { email: PACKAGES_ADMIN_EMAIL }, select: { id: true } }));
  if (existing && !options.rotateExisting) throw new Error("Admin already exists. Use --rotate-password for an intentional password rotation.");
  const id = existing?.id ?? randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  return withPrivateUser(id, () => prisma.user.upsert({
    where: { email: PACKAGES_ADMIN_EMAIL },
    create: { id, email: PACKAGES_ADMIN_EMAIL, name: "Packages Admin", passwordHash },
    update: options.rotateExisting ? { passwordHash, authVersion: { increment: 1 } } : {},
    select: { id: true, email: true },
  }));
}
