import "dotenv/config";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import type { TokenPayload } from "google-auth-library";

import { prisma } from "../lib/prisma";
import { googleLogin } from "./auth.service";
import { verifyGoogleCredential, type GoogleCredentialVerifier } from "./googleIdentity.service";

process.env.GOOGLE_CLIENT_ID ||= "test-google-client-id";

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const email = (label: string) => `google-${label}-${runId}@example.com`;
const payload = (overrides: Partial<TokenPayload> = {}): TokenPayload => ({
  iss: "accounts.google.com",
  aud: process.env.GOOGLE_CLIENT_ID!,
  sub: `subject-${runId}`,
  email: email("new"),
  email_verified: true,
  name: "Google Test User",
  iat: Math.floor(Date.now() / 1000) - 5,
  exp: Math.floor(Date.now() / 1000) + 300,
  ...overrides,
});
const verifier = (value: TokenPayload): GoogleCredentialVerifier => async () => value;

async function expectFailure(fn: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(fn, pattern);
}

async function run() {
  const verified = await verifyGoogleCredential({ credential: "valid" }, verifier(payload()));
  assert.equal(verified.email, email("new"));

  await expectFailure(
    () => verifyGoogleCredential({ credential: "invalid" }, async () => { throw new Error("bad signature"); }),
    /Invalid Google credential/,
  );
  await expectFailure(
    () => verifyGoogleCredential({ credential: "expired" }, async () => { throw new Error("Token used too late"); }),
    /Invalid Google credential/,
  );
  await expectFailure(
    () => verifyGoogleCredential({ credential: "wrong-audience" }, async () => { throw new Error("Wrong recipient"); }),
    /Invalid Google credential/,
  );
  await expectFailure(
    () => verifyGoogleCredential({ credential: "unverified" }, verifier(payload({ email_verified: false }))),
    /Invalid Google account/,
  );

  const created = await googleLogin({ credential: "new" }, verifier(payload()));
  assert.equal(created.user.email, email("new"));
  assert.ok(created.accessToken && created.refreshToken);

  const linkedEmail = email("linked");
  const passwordHash = await bcrypt.hash("password123", 4);
  const existing = await prisma.user.create({ data: { name: "Existing Name", email: linkedEmail, passwordHash } });
  const linked = await googleLogin(
    { credential: "linked" },
    verifier(payload({ sub: `linked-${runId}`, email: linkedEmail, name: "Replacement Name" })),
  );
  assert.equal(linked.user.id, existing.id);
  const preserved = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
  assert.equal(preserved.name, "Existing Name");
  assert.equal(preserved.passwordHash, passwordHash);

  const raceEmail = email("race");
  const raceVerifier = verifier(payload({ sub: `race-${runId}`, email: raceEmail }));
  const raced = await Promise.all([
    googleLogin({ credential: "race-a" }, raceVerifier),
    googleLogin({ credential: "race-b" }, raceVerifier),
  ]);
  assert.equal(raced[0].user.id, raced[1].user.id);
  assert.equal(await prisma.user.count({ where: { email: raceEmail } }), 1);
  assert.equal(await prisma.externalIdentity.count({ where: { providerAccountId: `race-${runId}` } }), 1);

  console.log("Google authentication tests passed.");
}

run()
  .finally(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${runId}@example.com` } } });
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Google authentication tests failed.");
    process.exitCode = 1;
  });
