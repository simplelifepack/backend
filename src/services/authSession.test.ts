import "dotenv/config";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";
import { login, logoutAll, refresh } from "./auth.service";

const email = `auth-session-${Date.now()}@example.com`;

async function run() {
  const user = await prisma.user.create({ data: { name: "Session Test", email, passwordHash: await bcrypt.hash("password123", 4) } });
  const first = await login({ email, password: "password123" });
  const second = await login({ email, password: "password123" });
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } }), 2);
  await logoutAll(user.id);
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } }), 0);
  await assert.rejects(() => refresh({ refreshToken: first.refreshToken }), /Invalid refresh token/);
  await assert.rejects(() => refresh({ refreshToken: second.refreshToken }), /Invalid refresh token/);
}

run().finally(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });
