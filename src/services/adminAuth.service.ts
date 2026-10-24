import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import type { AdminRole } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { verifyGoogleCredential } from "./googleIdentity.service";
import { writeAuditLog } from "./adminAudit.service";
import { signAdminPendingToken, signAdminToken, verifyAdminPendingToken } from "../utils/adminJwt";

class AdminAuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = "AdminAuthError";
    this.statusCode = statusCode;
  }
}

function rpConfig() {
  // Decision D2 / tracker: WebAuthn is real, not stubbed — localhost is a valid
  // relying party ID for browser testing. Production needs its real domain here.
  const rpID = process.env.ADMIN_WEBAUTHN_RP_ID?.trim() || "localhost";
  const origin = process.env.ADMIN_WEBAUTHN_ORIGIN?.trim() || "http://localhost:5174";
  const rpName = "Readiness Admin Console";
  return { rpID, origin, rpName };
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

async function storeChallenge(adminId: string, type: "registration" | "authentication", challenge: string) {
  await prisma.adminWebAuthnChallenge.deleteMany({ where: { adminId, type } });
  await prisma.adminWebAuthnChallenge.create({
    data: { adminId, type, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
}

async function consumeChallenge(adminId: string, type: "registration" | "authentication") {
  const row = await prisma.adminWebAuthnChallenge.findFirst({
    where: { adminId, type, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw new AdminAuthError("Challenge expired. Start again.", 400);
  await prisma.adminWebAuthnChallenge.delete({ where: { id: row.id } });
  return row.challenge;
}

// --- Step 1: Google identity -------------------------------------------------

/** Admin accounts are provisioned (via the bootstrap script / an Owner),
 * never self-registered — unlike customer sign-up, there is no path here that
 * creates an AdminUser from an unrecognized Google account. */
export async function beginAdminLogin(credential: unknown) {
  const identity = await verifyGoogleCredential(credential);
  const admin = await prisma.adminUser.findFirst({
    where: { email: identity.email },
  });

  if (!admin || admin.disabledAt) {
    await writeAuditLog(prisma, {
      adminId: null,
      actorEmail: identity.email,
      action: "auth.denied",
      reason: admin ? "account disabled" : "no matching admin account",
    });
    throw new AdminAuthError("This Google account is not provisioned for admin access.", 403);
  }

  if (!admin.googleSub) {
    await prisma.adminUser.update({ where: { id: admin.id }, data: { googleSub: identity.subject } });
  } else if (admin.googleSub !== identity.subject) {
    await writeAuditLog(prisma, {
      adminId: admin.id, actorEmail: admin.email, action: "auth.denied",
      reason: "Google subject mismatch",
    });
    throw new AdminAuthError("This Google account does not match the one on file.", 403);
  }

  const passkeyCount = await prisma.adminPasskey.count({ where: { adminId: admin.id } });
  const pendingToken = signAdminPendingToken({
    adminId: admin.id,
    purpose: passkeyCount === 0 ? "enroll" : "login",
  });
  return {
    status: passkeyCount === 0 ? ("passkey_enrollment_required" as const) : ("passkey_required" as const),
    pendingToken,
    admin: { name: admin.name, email: admin.email },
  };
}

function requirePending(pendingToken: string, purpose: "enroll" | "login") {
  let payload;
  try {
    payload = verifyAdminPendingToken(pendingToken);
  } catch {
    throw new AdminAuthError("Sign-in expired. Start again.", 401);
  }
  if (payload.purpose !== purpose) throw new AdminAuthError("Unexpected step. Start again.", 401);
  return payload.adminId;
}

// --- Step 2a: passkey enrollment (first login only) -------------------------

export async function enrollmentOptions(pendingToken: string) {
  const adminId = requirePending(pendingToken, "enroll");
  const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
  const { rpID, rpName } = rpConfig();
  const options = await generateRegistrationOptions({
    rpID,
    rpName,
    userName: admin.email,
    userDisplayName: admin.name,
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  await storeChallenge(adminId, "registration", options.challenge);
  return options;
}

export async function verifyEnrollment(pendingToken: string, response: RegistrationResponseJSON, deviceLabel: string | undefined, req: { ip?: string; userAgent?: string }) {
  const adminId = requirePending(pendingToken, "enroll");
  const challenge = await consumeChallenge(adminId, "registration");
  const { rpID, origin } = rpConfig();

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new AdminAuthError("Passkey registration could not be verified.", 400);
  }
  const { credential } = verification.registrationInfo;
  await prisma.adminPasskey.create({
    data: {
      adminId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      signCount: BigInt(credential.counter),
      transports: response.response.transports ?? [],
      deviceLabel: deviceLabel?.slice(0, 80),
    },
  });
  return completeLogin(adminId, req, { stepUp: true });
}

// --- Step 2b: passkey authentication (returning login) ----------------------

export async function loginOptions(pendingToken: string) {
  const adminId = requirePending(pendingToken, "login");
  const passkeys = await prisma.adminPasskey.findMany({ where: { adminId } });
  const { rpID } = rpConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: passkeys.map((pk) => ({ id: pk.credentialId, transports: pk.transports as AuthenticatorTransport[] })),
  });
  await storeChallenge(adminId, "authentication", options.challenge);
  return options;
}

export async function verifyLogin(pendingToken: string, response: AuthenticationResponseJSON, req: { ip?: string; userAgent?: string }) {
  const adminId = requirePending(pendingToken, "login");
  const challenge = await consumeChallenge(adminId, "authentication");
  const passkey = await prisma.adminPasskey.findUnique({ where: { credentialId: response.id } });
  if (!passkey || passkey.adminId !== adminId) throw new AdminAuthError("Unknown passkey.", 400);

  const { rpID, origin } = rpConfig();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: Number(passkey.signCount),
      transports: passkey.transports as AuthenticatorTransport[],
    },
  });
  if (!verification.verified) throw new AdminAuthError("Passkey could not be verified.", 400);

  await prisma.adminPasskey.update({
    where: { id: passkey.id },
    data: { signCount: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });
  return completeLogin(adminId, req, { stepUp: true });
}

// --- Step-up: re-verify an existing session before a privileged write -------

export async function stepUpOptions(adminId: string) {
  const passkeys = await prisma.adminPasskey.findMany({ where: { adminId } });
  const { rpID } = rpConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: passkeys.map((pk) => ({ id: pk.credentialId, transports: pk.transports as AuthenticatorTransport[] })),
  });
  await storeChallenge(adminId, "authentication", options.challenge);
  return options;
}

export async function verifyStepUp(adminId: string, sessionId: string, response: AuthenticationResponseJSON) {
  const challenge = await consumeChallenge(adminId, "authentication");
  const passkey = await prisma.adminPasskey.findUnique({ where: { credentialId: response.id } });
  if (!passkey || passkey.adminId !== adminId) throw new AdminAuthError("Unknown passkey.", 400);

  const { rpID, origin } = rpConfig();
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: Number(passkey.signCount),
      transports: passkey.transports as AuthenticatorTransport[],
    },
  });
  if (!verification.verified) throw new AdminAuthError("Passkey could not be verified.", 400);

  await prisma.adminPasskey.update({
    where: { id: passkey.id },
    data: { signCount: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });
  const stepUpAt = new Date();
  await prisma.adminSession.update({ where: { id: sessionId }, data: { stepUpAt } });
  return { stepUpAt };
}

// --- Shared: finish login, issue a session + token ---------------------------

async function completeLogin(
  adminId: string,
  req: { ip?: string; userAgent?: string },
  opts: { stepUp: boolean; action?: string; reason?: string },
) {
  const admin = await prisma.adminUser.update({
    where: { id: adminId },
    data: { lastLoginAt: new Date() },
  });
  const session = await prisma.adminSession.create({
    data: { adminId, ip: req.ip, userAgent: req.userAgent, stepUpAt: opts.stepUp ? new Date() : null },
  });
  await writeAuditLog(prisma, {
    adminId: admin.id, actorEmail: admin.email, action: opts.action ?? "auth.login",
    reason: opts.reason ?? `Google + passkey, session ${session.id}`,
  });
  const token = signAdminToken({
    sub: admin.id, email: admin.email, role: admin.role,
    sessionId: session.id, authVersion: admin.authVersion,
  });
  return {
    token,
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    session: { id: session.id, stepUpAt: session.stepUpAt },
  };
}

// --- Dev-only bypass: "Test as Admin" ---------------------------------------
//
// Skips Google + passkey entirely so the console is testable before OAuth/
// WebAuthn are wired end-to-end in a real browser session. Google sign-in
// itself is untouched (per 12 Oct instruction) — this is a second, separate
// door that only exists outside production. Finds-or-creates a throwaway
// "Dev <Role>" admin per role rather than reusing the bootstrapped owner, so
// all four roles in the access matrix are actually reachable for testing.
const DEV_ROLES: AdminRole[] = ["support", "catalogue", "ops_security", "owner"];

export async function devLogin(role: unknown, req: { ip?: string; userAgent?: string }) {
  if (process.env.NODE_ENV === "production") {
    throw new AdminAuthError("Not available in production.", 403);
  }
  const resolvedRole = DEV_ROLES.includes(role as AdminRole) ? (role as AdminRole) : "owner";
  const email = `dev-${resolvedRole}@readines.test`;
  const admin = await prisma.adminUser.upsert({
    where: { email },
    create: { email, name: `Dev ${resolvedRole}`, role: resolvedRole },
    update: {},
  });
  return completeLogin(admin.id, req, {
    stepUp: false, // exercise the real step-up gate even in dev mode
    action: "auth.dev_login",
    reason: `Dev bypass — Google/passkey skipped, role=${resolvedRole}. Not available in production.`,
  });
}

export async function logout(adminId: string, sessionId: string) {
  await prisma.adminSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
  await writeAuditLog(prisma, { adminId, actorEmail: admin.email, action: "auth.logout" });
}

export { AdminAuthError };
