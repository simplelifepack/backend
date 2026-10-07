import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";
import { changePin, login, loginWithPin, logoutAll, refresh, resetPin, setupPin } from "./auth.service";

const email = `auth-session-${Date.now()}@example.com`;

async function run() {
  const user = await prisma.user.create({ data: { name: "Session Test", email, passwordHash: await bcrypt.hash("password123", 4) } });
  const first = await login({ email, password: "password123" });
  assert.equal(first.user.pinConfigured, false);
  const configured = await setupPin(user.id, { pin: "012345" });
  assert.equal(configured.user.pinConfigured, true);
  const pinLogin = await loginWithPin({ email, pin: "012345" });
  assert.equal(pinLogin.user.email, email);
  await assert.rejects(() => loginWithPin({ email, pin: "999999" }), /Invalid email or PIN/);
  await changePin(user.id, { currentPin: "012345", newPin: "000001" });
  await assert.rejects(() => loginWithPin({ email, pin: "012345" }), /Invalid email or PIN/);
  const changedPinLogin = await loginWithPin({ email, pin: "000001" });
  assert.equal(changedPinLogin.user.pinConfigured, true);
  await prisma.accountChangeOtp.create({
    data: {
      userId: user.id,
      purpose: "pin",
      otpHash: createHash("sha256").update(`account-change:${user.id}:pin:111111`).digest("hex"),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  await resetPin(user.id, { otp: "111111", newPin: "000002" });
  const resetPinLogin = await loginWithPin({ email, pin: "000002" });
  assert.equal(resetPinLogin.user.pinConfigured, true);
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
