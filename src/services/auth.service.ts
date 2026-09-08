import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { signAccessToken } from "../utils/jwt";
import * as emailService from "./email/emailService";
import { verifyGoogleCredential, type GoogleCredentialVerifier } from "./googleIdentity.service";
import { acceptTrustInvitationsForUser } from "./trustCenter.service";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  authVersion?: number;
  accountTier?: "free" | "paid";
  recoverySetupComplete?: boolean;
};

type AuthResult = {
  token: string;
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("A valid email is required."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const loginSchema = z.object({
  email: z.string().trim().email("A valid email is required."),
  password: z.string().min(1, "Password is required."),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("A valid email is required."),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(32, "Reset token is required."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required."),
});

const REFRESH_TOKEN_DAYS = 30;
const PASSWORD_RESET_MINUTES = 30;
const PASSWORD_RESET_MESSAGE = "If an account exists for that email, password reset instructions will be sent.";

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
    recoverySetupComplete: user.recoverySetupComplete ?? false,
  };
}

function hashRefreshToken(refreshToken: string) {
  return createHash("sha256").update(refreshToken).digest("hex");
}

function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
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

function buildPasswordResetUrl(token: string) {
  const appUrl = process.env.APP_URL?.trim() || "http://localhost:5173";
  const resetUrl = new URL("/reset-password", appUrl);
  resetUrl.searchParams.set("token", token);
  return resetUrl.toString();
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

async function buildAuthResult(user: AuthUser): Promise<AuthResult> {
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    authVersion: user.authVersion ?? 0,

  });

  return {
    token: accessToken,
    accessToken,
    refreshToken: await createRefreshToken(user.id, user.authVersion ?? 0),
    user: toAuthUser(user),
  };
}

function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: {
      email: email.toLowerCase(),
    },
  });
}

export async function signup(input: unknown): Promise<AuthResult> {
  const { name, email, password } = signupSchema.parse(input);

  if (await findUserByEmail(email)) {
    throw httpError("An account with this email already exists.", 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash,
    },
    select: {
      id: true,
      name: true,
      email: true,
      authVersion: true,
      accountTier: true,
      recoverySetupComplete: true,
    },
  });

  const result = await buildAuthResult(user);
  await acceptTrustInvitationsForUser(user.id, user.email);
  await emailService.sendWelcomeEmail(user);
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

  const result = await buildAuthResult(user);
  await acceptTrustInvitationsForUser(user.id, user.email);
  await emailService.sendLoginAlertEmail(user, context);
  return result;
}

export async function googleLogin(
  input: unknown,
  verifier?: GoogleCredentialVerifier,
  context?: emailService.LoginAlertContext,
): Promise<AuthResult> {
  const google = await verifyGoogleCredential(input, verifier);

  let user: AuthUser | undefined;
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

  const result = await buildAuthResult(user);
  await acceptTrustInvitationsForUser(user.id, user.email);
  if (emailType === "welcome") {
    await emailService.sendWelcomeEmail(user);
  } else {
    await emailService.sendLoginAlertEmail(user, context);
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
          recoverySetupComplete: true,
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

  return buildAuthResult(savedRefreshToken.user);
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
  await prisma.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { message: "Logged out on all devices." };
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
    await emailService.sendPasswordResetEmail(user, buildPasswordResetUrl(token));
  }

  return {
    message: PASSWORD_RESET_MESSAGE,
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
  await prisma.$transaction(async (tx) => {
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

    await tx.user.update({
      where: {
        id: savedToken.userId,
      },
      data: {
        passwordHash,
        authVersion: { increment: 1 },
        recoveryVerifier: null,
        recoverySetupComplete: false,
      },
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
  });

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
      recoverySetupComplete: true,
    },
  });

  return user ? toAuthUser(user) : null;
}
