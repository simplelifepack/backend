import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { signAccessToken } from "../utils/jwt";
import * as emailService from "./email/emailService";
import { verifyGoogleCredential, type GoogleCredentialVerifier } from "./googleIdentity.service";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
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

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required."),
});

const REFRESH_TOKEN_DAYS = 30;

function toAuthUser(user: AuthUser): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function hashRefreshToken(refreshToken: string) {
  return createHash("sha256").update(refreshToken).digest("hex");
}

function getRefreshTokenExpiry() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_DAYS);
  return expiresAt;
}

async function createRefreshToken(userId: string) {
  const refreshToken = randomBytes(48).toString("base64url");

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashRefreshToken(refreshToken),
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
  });

  return {
    token: accessToken,
    accessToken,
    refreshToken: await createRefreshToken(user.id),
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
    throw new Error("An account with this email already exists.");
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
    },
  });

  const result = await buildAuthResult(user);
  await emailService.sendWelcomeEmail(user);
  return result;
}

export async function login(input: unknown, context?: emailService.LoginAlertContext): Promise<AuthResult> {
  const { email, password } = loginSchema.parse(input);
  const user = await findUserByEmail(email);

  if (!user) {
    throw new Error("Invalid email or password.");
  }

  if (!user.passwordHash) {
    throw new Error("Invalid email or password.");
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);

  if (!isMatch) {
    throw new Error("Invalid email or password.");
  }

  const result = await buildAuthResult(user);
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
        },
      },
    },
  });

  if (
    !savedRefreshToken ||
    savedRefreshToken.revokedAt ||
    savedRefreshToken.expiresAt <= new Date()
  ) {
    throw new Error("Invalid refresh token.");
  }

  await prisma.refreshToken.update({
    where: {
      id: savedRefreshToken.id,
    },
    data: {
      revokedAt: new Date(),
    },
  });

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

export function forgotPassword(input: unknown) {
  forgotPasswordSchema.parse(input);

  return {
    message: "If an account exists for that email, password reset instructions will be sent.",
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
    },
  });

  return user ? toAuthUser(user) : null;
}
