import bcrypt from "bcrypt";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { signAccessToken } from "../utils/jwt";
import * as emailService from "./email/emailService";
import { verifyGoogleCredential, type GoogleCredentialVerifier } from "./googleIdentity.service";
import { acceptTrustInvitationsForUser } from "./trustCenter.service";
import { cancelPendingDeletion } from "./accountDeletion.service";
import { noteAuthVersion } from "./authRevocationCache";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  authVersion?: number;
  accountTier?: "free" | "paid";
  pinConfigured?: boolean;
};

type AuthResult = {
  token: string;
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  deletionCancelled?: boolean;
};

const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("A valid email is required."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const signupOtpSchema = signupSchema.extend({
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your email."),
});

const loginSchema = z.object({
  email: z.string().trim().email("A valid email is required."),
  password: z.string().min(1, "Password is required."),
});

const pinRules = z.string().regex(/^\d{6}$/, "Enter a 6-digit PIN.");

const pinLoginSchema = z.object({
  email: z.string().trim().email("A valid email is required."),
  pin: pinRules,
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("A valid email is required."),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(32, "Reset token is required."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const resetPasswordOtpSchema = z.object({
  email: z.string().trim().email("A valid email is required."),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your email."),
  password: z.string()
    .min(8, "Password must be at least 8 characters.")
    .regex(/[a-z]/, "Password must include a lowercase letter.")
    .regex(/[A-Z]/, "Password must include an uppercase letter.")
    .regex(/\d/, "Password must include a number.")
    .regex(/[^A-Za-z0-9]/, "Password must include a symbol."),
});

const passwordRules = z.string()
  .min(8, "Password must be at least 8 characters.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/\d/, "Password must include a number.")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol.");

const requestEmailChangeSchema = z.object({
  newEmail: z.string().trim().email("A valid email is required."),
  currentPassword: z.string().min(1, "Current password is required."),
});

const requestPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: passwordRules,
});

const setupPinSchema = z.object({
  pin: pinRules,
});

const changePinSchema = z.object({
  currentPin: pinRules,
  newPin: pinRules,
});

const resetPinSchema = z.object({
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your email."),
  newPin: pinRules,
});

const verifyAccountChangeSchema = z.object({
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your email."),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required."),
});

const REFRESH_TOKEN_DAYS = 30;
const PASSWORD_RESET_MINUTES = 30;
const SIGNUP_OTP_MINUTES = 30;
const ACCOUNT_CHANGE_OTP_MINUTES = 10;
const ACCOUNT_CHANGE_RESEND_SECONDS = 60;
const ACCOUNT_CHANGE_MAX_ATTEMPTS = 5;
const SIGNUP_OTP_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_OTP_MAX_ATTEMPTS = 5;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MINUTES = 15;
const PASSWORD_RESET_MESSAGE = "If an account exists for that email, password reset instructions will be sent.";
const PASSWORD_RESET_OTP_MESSAGE = "If an account exists for that email, a password reset code will be sent.";
const PIN_LOGIN_MESSAGE = "Invalid email or PIN.";

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function toAuthUser(user: AuthUser): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    authVersion: user.authVersion ?? 0,
    accountTier: user.accountTier ?? "free",
    pinConfigured: user.pinConfigured ?? false,
  };
}

function hashRefreshToken(refreshToken: string) {
  return createHash("sha256").update(refreshToken).digest("hex");
}

function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPasswordResetOtp(userId: string, otp: string) {
  return hashPasswordResetToken(`otp:${userId}:${otp}`);
}

function hashSignupOtp(email: string, otp: string) {
  return hashPasswordResetToken(`signup:${email.toLowerCase()}:${otp}`);
}

function hashAccountChangeOtp(userId: string, purpose: string, otp: string) {
  return hashPasswordResetToken(`account-change:${userId}:${purpose}:${otp}`);
}

function getPinLockoutExpiry() {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + PIN_LOCKOUT_MINUTES);
  return expiresAt;
}

function getRefreshTokenExpiry() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_DAYS);
  return expiresAt;
}

function getPasswordResetExpiry() {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + PASSWORD_RESET_MINUTES);
  return expiresAt;
}

function getSignupOtpExpiry() {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + SIGNUP_OTP_MINUTES);
  return expiresAt;
}

function getAccountChangeOtpExpiry() {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + ACCOUNT_CHANGE_OTP_MINUTES);
  return expiresAt;
}

function assertOtpCooldown(updatedAt: Date) {
  const elapsedMs = Date.now() - updatedAt.getTime();
  if (elapsedMs < ACCOUNT_CHANGE_RESEND_SECONDS * 1000) {
    throw httpError("Please wait before requesting another code.", 429);
  }
}

function buildPasswordResetUrl(token: string) {
  const appUrl = process.env.APP_URL?.trim() || "http://localhost:5173";
  const resetUrl = new URL("/reset-password", appUrl);
  resetUrl.searchParams.set("token", token);
  return resetUrl.toString();
}

function dispatchAuthEmail(send: () => Promise<unknown>) {
  setTimeout(() => {
    send().catch((error) => {
      console.error({
        event: "auth_email_background_failed",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
    });
  }, 0);
}

async function createRefreshToken(userId: string, authVersion: number) {
  const refreshToken = randomBytes(48).toString("base64url");

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashRefreshToken(refreshToken),
      authVersion,
      userId,
      expiresAt: getRefreshTokenExpiry(),
    },
  });

  return refreshToken;
}

async function buildAuthResult(user: AuthUser, extra: Pick<AuthResult, "deletionCancelled"> = {}): Promise<AuthResult> {
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    authVersion: user.authVersion ?? 0,
  });

  return {
    token: accessToken,
    accessToken,
    refreshToken: await createRefreshToken(user.id, user.authVersion ?? 0),
    user: toAuthUser(user),
    ...extra,
  };
}

function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: {
      email: email.toLowerCase(),
    },
  });
}

function selectAuthUser(user: {
  id: string;
  name: string;
  email: string;
  authVersion?: number | null;
  accountTier?: "free" | "paid" | null;
  pinHash?: string | null;
}): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    authVersion: user.authVersion ?? 0,
    accountTier: user.accountTier ?? "free",
    pinConfigured: Boolean(user.pinHash),
  };
}

async function markPinFailure(userId: string, currentAttempts: number) {
  const nextAttempts = currentAttempts + 1;
  await prisma.user.update({
    where: { id: userId },
    data: {
      pinAttemptCount: nextAttempts,
      pinLockedUntil: nextAttempts >= PIN_MAX_ATTEMPTS ? getPinLockoutExpiry() : null,
    },
  });
}

async function clearPinFailures(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { pinAttemptCount: 0, pinLockedUntil: null },
  });
}

async function assertPinMatches(user: {
  id: string;
  pinHash: string | null;
  pinAttemptCount: number;
  pinLockedUntil: Date | null;
}, pin: string, message = "Invalid PIN.") {
  const now = new Date();
  if (!user.pinHash || (user.pinLockedUntil && user.pinLockedUntil > now)) {
    throw httpError(message, 401);
  }

  const isMatch = await bcrypt.compare(pin, user.pinHash);
  if (!isMatch) {
    await markPinFailure(user.id, user.pinAttemptCount);
    throw httpError(message, 401);
  }

  if (user.pinAttemptCount > 0 || user.pinLockedUntil) await clearPinFailures(user.id);
}

export async function requestSignupOtp(input: unknown) {
  const { name, email, password } = signupSchema.parse(input);
  const normalizedEmail = email.toLowerCase();

  if (await findUserByEmail(email)) {
    throw httpError("User already exists. Log in.", 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const otp = String(randomInt(100000, 1000000));

  await prisma.signupVerification.upsert({
    where: { email: normalizedEmail },
    update: {
      name,
      passwordHash,
      otpHash: hashSignupOtp(normalizedEmail, otp),
      expiresAt: getSignupOtpExpiry(),
      attemptCount: 0,
    },
    create: {
      name,
      email: normalizedEmail,
      passwordHash,
      otpHash: hashSignupOtp(normalizedEmail, otp),
      expiresAt: getSignupOtpExpiry(),
    },
  });

  const delivery = await emailService.sendSignupOtpEmail({ email: normalizedEmail }, otp);
  if (!delivery.sent) {
    throw httpError("Unable to send signup code. Please contact support@readiness.com.", 502);
  }

  return {
    message: "We sent a 6-digit signup code to your email.",
  };
}

export async function signup(input: unknown): Promise<AuthResult> {
  const { name, email, otp } = signupOtpSchema.parse(input);
  const normalizedEmail = email.toLowerCase();

  if (await findUserByEmail(normalizedEmail)) {
    throw httpError("User already exists. Log in.", 409);
  }

  const pending = await prisma.signupVerification.findUnique({
    where: { email: normalizedEmail },
  });

  const now = new Date();
  const expectedHash = hashSignupOtp(normalizedEmail, otp);

  if (!pending || pending.expiresAt <= now || pending.attemptCount >= SIGNUP_OTP_MAX_ATTEMPTS || pending.otpHash !== expectedHash) {
    if (pending && pending.expiresAt > now && pending.attemptCount < SIGNUP_OTP_MAX_ATTEMPTS) {
      await prisma.signupVerification.updateMany({
        where: { email: normalizedEmail, attemptCount: { lt: SIGNUP_OTP_MAX_ATTEMPTS } },
        data: { attemptCount: { increment: 1 } },
      });
    }
    throw httpError("Invalid or expired signup code.", 400);
  }

  const user = await prisma.$transaction(async (tx) => {
    const claimed = await tx.signupVerification.deleteMany({
      where: {
        id: pending.id,
        email: normalizedEmail,
        otpHash: expectedHash,
        expiresAt: { gt: new Date() },
        attemptCount: { lt: SIGNUP_OTP_MAX_ATTEMPTS },
      },
    });
    if (claimed.count !== 1) throw httpError("Invalid or expired signup code.", 400);

    const created = await tx.user.create({
      data: {
        name: pending.name || name,
        email: normalizedEmail,
        passwordHash: pending.passwordHash,
      },
      select: {
        id: true,
        name: true,
        email: true,
        authVersion: true,
        accountTier: true,
        pinHash: true,
      },
    });
    return selectAuthUser(created);
  });

  const deletionCancelled = await cancelPendingDeletion(user.id);
  const result = await buildAuthResult(user, { deletionCancelled });
  await acceptTrustInvitationsForUser(user.id, user.email);
  dispatchAuthEmail(() => emailService.sendWelcomeEmail(user));
  return result;
}

export async function login(input: unknown, context?: emailService.LoginAlertContext): Promise<AuthResult> {
  const { email, password } = loginSchema.parse(input);
  const user = await findUserByEmail(email);

  if (!user) {
    throw httpError("Invalid email or password.", 401);
  }

  if (!user.passwordHash) {
    throw httpError("Invalid email or password.", 401);
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);

  if (!isMatch) {
    throw httpError("Invalid email or password.", 401);
  }

  const authUser = selectAuthUser(user);
  const deletionCancelled = await cancelPendingDeletion(user.id);
  const result = await buildAuthResult(authUser, { deletionCancelled });
  await acceptTrustInvitationsForUser(user.id, user.email);
  dispatchAuthEmail(() => emailService.sendLoginAlertEmail(user, context));
  return result;
}

export async function loginWithPin(input: unknown, context?: emailService.LoginAlertContext): Promise<AuthResult> {
  const { email, pin } = pinLoginSchema.parse(input);
  const user = await findUserByEmail(email);

  if (!user?.pinHash) {
    throw httpError(PIN_LOGIN_MESSAGE, 401);
  }

  await assertPinMatches(user, pin, PIN_LOGIN_MESSAGE);

  const authUser = selectAuthUser(user);
  const deletionCancelled = await cancelPendingDeletion(user.id);
  const result = await buildAuthResult(authUser, { deletionCancelled });
  await acceptTrustInvitationsForUser(user.id, user.email);
  dispatchAuthEmail(() => emailService.sendLoginAlertEmail(user, context));
  return result;
}

export async function setupPin(userId: string, input: unknown) {
  const { pin } = setupPinSchema.parse(input);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw httpError("Unauthorized.", 401);
  if (user.pinHash) {
    return { message: "PIN already configured.", user: toAuthUser(selectAuthUser(user)) };
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      pinHash: await bcrypt.hash(pin, 10),
      pinAttemptCount: 0,
      pinLockedUntil: null,
    },
    select: { id: true, name: true, email: true, authVersion: true, accountTier: true, pinHash: true },
  });

  return { message: "PIN configured.", user: toAuthUser(selectAuthUser(updated)) };
}

export async function changePin(userId: string, input: unknown) {
  const { currentPin, newPin } = changePinSchema.parse(input);
  if (currentPin === newPin) throw httpError("New PIN must be different from your current PIN.", 400);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw httpError("Unauthorized.", 401);
  await assertPinMatches(user, currentPin);

  await prisma.user.update({
    where: { id: userId },
    data: {
      pinHash: await bcrypt.hash(newPin, 10),
      pinAttemptCount: 0,
      pinLockedUntil: null,
    },
  });

  return { message: "PIN updated." };
}

export async function requestPinReset(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw httpError("Unauthorized.", 401);

  const previous = await prisma.accountChangeOtp.findUnique({ where: { userId_purpose: { userId, purpose: "pin" } } });
  if (previous) assertOtpCooldown(previous.updatedAt);

  const otp = String(randomInt(100000, 1000000));
  await prisma.accountChangeOtp.upsert({
    where: { userId_purpose: { userId, purpose: "pin" } },
    update: {
      newEmail: null,
      newPasswordHash: null,
      newPinHash: null,
      otpHash: hashAccountChangeOtp(userId, "pin", otp),
      expiresAt: getAccountChangeOtpExpiry(),
      attemptCount: 0,
    },
    create: {
      userId,
      purpose: "pin",
      otpHash: hashAccountChangeOtp(userId, "pin", otp),
      expiresAt: getAccountChangeOtpExpiry(),
    },
  });

  const delivery = await emailService.sendAccountChangeOtpEmail({ userId, email: user.email, purpose: "pin" }, otp);
  if (!delivery.sent) throw httpError("Unable to send verification code. Please contact support@readiness.com.", 502);
  return { message: "We sent a verification code to your email." };
}

export async function resetPin(userId: string, input: unknown) {
  const { otp, newPin } = resetPinSchema.parse(input);
  const saved = await prisma.accountChangeOtp.findUnique({ where: { userId_purpose: { userId, purpose: "pin" } } });
  const now = new Date();
  if (!saved || saved.expiresAt <= now || saved.attemptCount >= ACCOUNT_CHANGE_MAX_ATTEMPTS || saved.otpHash !== hashAccountChangeOtp(userId, "pin", otp)) {
    if (saved && saved.attemptCount < ACCOUNT_CHANGE_MAX_ATTEMPTS) {
      await prisma.accountChangeOtp.update({ where: { id: saved.id }, data: { attemptCount: { increment: 1 } } });
    }
    throw httpError("Invalid or expired verification code.", 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        pinHash: await bcrypt.hash(newPin, 10),
        pinAttemptCount: 0,
        pinLockedUntil: null,
      },
    });
    await tx.accountChangeOtp.delete({ where: { id: saved.id } });
  });

  return { message: "PIN updated." };
}

export async function googleLogin(
  input: unknown,
  verifier?: GoogleCredentialVerifier,
  context?: emailService.LoginAlertContext,
): Promise<AuthResult> {
  const google = await verifyGoogleCredential(input, verifier);

  let user: User | undefined;
  let emailType: "welcome" | "login_alert" = "login_alert";
  for (let attempt = 0; attempt < 3 && !user; attempt += 1) {
    try {
      const authenticated = await prisma.$transaction(async (tx) => {
        const existingIdentity = await tx.externalIdentity.findUnique({
          where: {
            provider_providerAccountId: {
              provider: "google",
              providerAccountId: google.subject,
            },
          },
          include: { user: true },
        });

        if (existingIdentity) return { user: existingIdentity.user, emailType: "login_alert" as const };

        const existingUser = await tx.user.findUnique({ where: { email: google.email } });
        const linkedUser = existingUser ?? await tx.user.create({
          data: {
            email: google.email,
            name: google.name || google.givenName || google.email.split("@")[0],
            passwordHash: null,
          },
        });

        await tx.externalIdentity.create({
          data: {
            userId: linkedUser.id,
            provider: "google",
            providerAccountId: google.subject,
            avatarUrl: google.picture,
          },
        });

        return {
          user: linkedUser,
          emailType: existingUser ? "login_alert" as const : "welcome" as const,
        };
      }, { isolationLevel: "Serializable" });
      user = authenticated.user;
      emailType = authenticated.emailType;
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === "P2002" || error.code === "P2034");
      if (!retryable || attempt === 2) throw error;
    }
  }

  if (!user) throw new Error("Unable to authenticate with Google.");

  const authUser = selectAuthUser(user);
  const result = await buildAuthResult(authUser);
  await acceptTrustInvitationsForUser(user.id, user.email);
  if (emailType === "welcome") {
    dispatchAuthEmail(() => emailService.sendWelcomeEmail(user));
  } else {
    dispatchAuthEmail(() => emailService.sendLoginAlertEmail(user, context));
  }
  return result;
}

export async function refresh(input: unknown): Promise<AuthResult> {
  const { refreshToken } = refreshTokenSchema.parse(input);
  const tokenHash = hashRefreshToken(refreshToken);

  const savedRefreshToken = await prisma.refreshToken.findUnique({
    where: {
      tokenHash,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          authVersion: true,
          accountTier: true,
          pinHash: true,
        },
      },
    },
  });

  if (
    !savedRefreshToken ||
    savedRefreshToken.revokedAt ||
    savedRefreshToken.expiresAt <= new Date() ||
    savedRefreshToken.authVersion !== (savedRefreshToken.user.authVersion ?? 0)
  ) {
    throw httpError("Invalid refresh token.", 401);
  }

  const claimed = await prisma.refreshToken.updateMany({
    where: { id: savedRefreshToken.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) throw httpError("Invalid refresh token.", 401);

  const authUser = selectAuthUser(savedRefreshToken.user);
  const deletionCancelled = await cancelPendingDeletion(savedRefreshToken.user.id);
  return buildAuthResult(authUser, { deletionCancelled });
}

export async function logout(input: unknown) {
  const { refreshToken } = refreshTokenSchema.parse(input);

  await prisma.refreshToken.updateMany({
    where: {
      tokenHash: hashRefreshToken(refreshToken),
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return {
    message: "Logged out.",
  };
}

export async function logoutAll(userId: string) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { authVersion: { increment: 1 } },
    select: { authVersion: true },
  });
  noteAuthVersion(userId, updated.authVersion);
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { message: "Logged out on all devices." };
}

export async function requestEmailChange(userId: string, input: unknown) {
  const { newEmail, currentPassword } = requestEmailChangeSchema.parse(input);
  const normalizedEmail = newEmail.toLowerCase();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash) throw httpError("Current password is incorrect.", 400);
  if (normalizedEmail === user.email.toLowerCase()) throw httpError("New email must be different from your current email.", 400);
  if (!await bcrypt.compare(currentPassword, user.passwordHash)) throw httpError("Current password is incorrect.", 400);
  if (await findUserByEmail(normalizedEmail)) throw httpError("Unable to use that email address.", 409);

  const previous = await prisma.accountChangeOtp.findUnique({ where: { userId_purpose: { userId, purpose: "email" } } });
  if (previous) assertOtpCooldown(previous.updatedAt);

  const otp = String(randomInt(100000, 1000000));
  await prisma.accountChangeOtp.upsert({
    where: { userId_purpose: { userId, purpose: "email" } },
    update: {
      newEmail: normalizedEmail,
      newPasswordHash: null,
      newPinHash: null,
      otpHash: hashAccountChangeOtp(userId, "email", otp),
      expiresAt: getAccountChangeOtpExpiry(),
      attemptCount: 0,
    },
    create: {
      userId,
      purpose: "email",
      newEmail: normalizedEmail,
      otpHash: hashAccountChangeOtp(userId, "email", otp),
      expiresAt: getAccountChangeOtpExpiry(),
    },
  });

  const delivery = await emailService.sendAccountChangeOtpEmail({ userId, email: user.email, purpose: "email" }, otp);
  if (!delivery.sent) throw httpError("Unable to send verification code. Please contact support@readiness.com.", 502);
  return { message: "We sent a verification code to your current email." };
}

export async function verifyEmailChange(userId: string, input: unknown) {
  const { otp } = verifyAccountChangeSchema.parse(input);
  const saved = await prisma.accountChangeOtp.findUnique({ where: { userId_purpose: { userId, purpose: "email" } } });
  const now = new Date();
  if (!saved || !saved.newEmail || saved.expiresAt <= now || saved.attemptCount >= ACCOUNT_CHANGE_MAX_ATTEMPTS || saved.otpHash !== hashAccountChangeOtp(userId, "email", otp)) {
    if (saved && saved.attemptCount < ACCOUNT_CHANGE_MAX_ATTEMPTS) {
      await prisma.accountChangeOtp.update({ where: { id: saved.id }, data: { attemptCount: { increment: 1 } } });
    }
    throw httpError("Invalid or expired verification code.", 400);
  }

  const requestedEmail = saved.newEmail;
  const user = await prisma.$transaction(async (tx) => {
    const duplicate = await tx.user.findFirst({ where: { email: requestedEmail, id: { not: userId } }, select: { id: true } });
    if (duplicate) throw httpError("Unable to use that email address.", 409);
    const updated = await tx.user.update({
      where: { id: userId },
      data: { email: requestedEmail, authVersion: { increment: 1 } },
      select: { id: true, name: true, email: true, authVersion: true, accountTier: true, pinHash: true },
    });
    await tx.accountChangeOtp.delete({ where: { id: saved.id } });
    return updated;
  });
  noteAuthVersion(userId, user.authVersion ?? 0);

  return { message: "Email updated.", user: toAuthUser(selectAuthUser(user)) };
}

export async function requestPasswordChange(userId: string, input: unknown) {
  const { currentPassword, newPassword } = requestPasswordChangeSchema.parse(input);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash) throw httpError("Current password is incorrect.", 400);
  if (!await bcrypt.compare(currentPassword, user.passwordHash)) throw httpError("Current password is incorrect.", 400);
  if (await bcrypt.compare(newPassword, user.passwordHash)) throw httpError("New password must be different from your current password.", 400);

  const previous = await prisma.accountChangeOtp.findUnique({ where: { userId_purpose: { userId, purpose: "password" } } });
  if (previous) assertOtpCooldown(previous.updatedAt);

  const otp = String(randomInt(100000, 1000000));
  const newPasswordHash = await bcrypt.hash(newPassword, 10);
  await prisma.accountChangeOtp.upsert({
    where: { userId_purpose: { userId, purpose: "password" } },
    update: {
      newEmail: null,
      newPasswordHash,
      newPinHash: null,
      otpHash: hashAccountChangeOtp(userId, "password", otp),
      expiresAt: getAccountChangeOtpExpiry(),
      attemptCount: 0,
    },
    create: {
      userId,
      purpose: "password",
      newPasswordHash,
      otpHash: hashAccountChangeOtp(userId, "password", otp),
      expiresAt: getAccountChangeOtpExpiry(),
    },
  });

  const delivery = await emailService.sendAccountChangeOtpEmail({ userId, email: user.email, purpose: "password" }, otp);
  if (!delivery.sent) throw httpError("Unable to send verification code. Please contact support@readiness.com.", 502);
  return { message: "We sent a verification code to your email." };
}

export async function verifyPasswordChange(userId: string, input: unknown) {
  const { otp } = verifyAccountChangeSchema.parse(input);
  const saved = await prisma.accountChangeOtp.findUnique({ where: { userId_purpose: { userId, purpose: "password" } } });
  const now = new Date();
  if (!saved || !saved.newPasswordHash || saved.expiresAt <= now || saved.attemptCount >= ACCOUNT_CHANGE_MAX_ATTEMPTS || saved.otpHash !== hashAccountChangeOtp(userId, "password", otp)) {
    if (saved && saved.attemptCount < ACCOUNT_CHANGE_MAX_ATTEMPTS) {
      await prisma.accountChangeOtp.update({ where: { id: saved.id }, data: { attemptCount: { increment: 1 } } });
    }
    throw httpError("Invalid or expired verification code.", 400);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const nextUser = await tx.user.update({
      where: { id: userId },
      data: { passwordHash: saved.newPasswordHash, authVersion: { increment: 1 } },
      select: { authVersion: true },
    });
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.accountChangeOtp.delete({ where: { id: saved.id } });
    return nextUser;
  });
  noteAuthVersion(userId, updated.authVersion);

  return { message: "Password updated. Please sign in again." };
}

export async function forgotPassword(input: unknown) {
  const { email } = forgotPasswordSchema.parse(input);
  const user = await findUserByEmail(email);

  if (user) {
    const token = randomBytes(48).toString("base64url");
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: hashPasswordResetToken(token),
        userId: user.id,
        expiresAt: getPasswordResetExpiry(),
      },
    });
    await emailService.sendPasswordResetEmail(user, buildPasswordResetUrl(token)).catch((error) => {
      console.error({
        event: "password_reset_email_failed",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
    });
  }

  return {
    message: PASSWORD_RESET_MESSAGE,
  };
}

export async function requestPasswordResetOtp(input: unknown) {
  const { email } = forgotPasswordSchema.parse(input);
  const user = await findUserByEmail(email);

  if (!user) {
    return {
      message: PASSWORD_RESET_OTP_MESSAGE,
    };
  }

  const otp = String(randomInt(100000, 1000000));
  await prisma.passwordResetToken.updateMany({
    where: {
      userId: user.id,
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashPasswordResetOtp(user.id, otp),
      userId: user.id,
      expiresAt: getPasswordResetExpiry(),
    },
  });
  const delivery = await emailService.sendPasswordResetOtpEmail(user, otp).catch((error) => {
    console.error({
      event: "password_reset_otp_email_failed",
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return { sent: false };
  });
  if (!delivery.sent) console.error({ event: "password_reset_otp_email_not_sent" });

  return {
    message: PASSWORD_RESET_OTP_MESSAGE,
  };
}

export async function resetPasswordWithOtp(input: unknown) {
  const { email, otp, password } = resetPasswordOtpSchema.parse(input);
  const user = await findUserByEmail(email);
  const now = new Date();
  const savedToken = user
    ? await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tokenHash: true,
        userId: true,
        expiresAt: true,
        attemptCount: true,
      },
    })
    : null;

  const expectedHash = user ? hashPasswordResetOtp(user.id, otp) : hashPasswordResetToken(`missing:${otp}`);
  if (!user || !savedToken || savedToken.userId !== user.id || savedToken.attemptCount >= PASSWORD_RESET_OTP_MAX_ATTEMPTS) {
    throw httpError("Invalid or expired password reset code.", 400);
  }

  if (savedToken.tokenHash !== expectedHash) {
    await prisma.passwordResetToken.updateMany({
      where: {
        id: savedToken.id,
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: now },
        attemptCount: { lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
      },
      data: {
        attemptCount: { increment: 1 },
        ...(savedToken.attemptCount + 1 >= PASSWORD_RESET_OTP_MAX_ATTEMPTS ? { usedAt: now } : {}),
      },
    });
    throw httpError("Invalid or expired password reset code.", 400);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: {
        id: savedToken.id,
        userId: user.id,
        tokenHash: expectedHash,
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
        attemptCount: { lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
      },
      data: {
        usedAt: new Date(),
      },
    });

    if (claimed.count !== 1) {
      throw httpError("Invalid or expired password reset code.", 400);
    }

    const nextUser = await tx.user.update({
      where: {
        id: user.id,
      },
      data: {
        passwordHash,
        authVersion: { increment: 1 },
      },
      select: { authVersion: true },
    });
    await tx.refreshToken.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
    return nextUser;
  });
  noteAuthVersion(user.id, updated.authVersion);

  return {
    message: "Password updated. Please sign in again.",
  };
}

export async function resetPassword(input: unknown) {
  const { token, password } = resetPasswordSchema.parse(input);
  const tokenHash = hashPasswordResetToken(token);
  const savedToken = await prisma.passwordResetToken.findUnique({
    where: {
      tokenHash,
    },
    select: {
      id: true,
      userId: true,
      usedAt: true,
      expiresAt: true,
    },
  });

  if (!savedToken || savedToken.usedAt || savedToken.expiresAt <= new Date()) {
    throw httpError("Invalid or expired password reset link.", 400);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: {
        id: savedToken.id,
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        usedAt: new Date(),
      },
    });

    if (claimed.count !== 1) {
      throw httpError("Invalid or expired password reset link.", 400);
    }

    const nextUser = await tx.user.update({
      where: {
        id: savedToken.userId,
      },
      data: {
        passwordHash,
        authVersion: { increment: 1 },
      },
      select: { authVersion: true },
    });
    await tx.refreshToken.updateMany({
      where: {
        userId: savedToken.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
    return nextUser;
  });
  noteAuthVersion(savedToken.userId, updated.authVersion);

  return {
    message: "Password reset successfully. Please sign in with your new password.",
  };
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
      name: true,
      email: true,
      authVersion: true,
      accountTier: true,
      pinHash: true,
    },
  });

  return user ? toAuthUser(selectAuthUser(user)) : null;
}
