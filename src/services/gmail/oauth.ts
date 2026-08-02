import { createHash, randomBytes } from "node:crypto";
import { google } from "googleapis";

import { prisma } from "../../lib/prisma";
import { gmailConfig, GMAIL_SCOPE } from "./config";
import { decryptGmailToken, encryptGmailToken } from "./tokenEncryption";

const STATE_TTL_MS = 10 * 60 * 1000;
const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

export type GmailOAuthErrorCode =
  | "invalid_state"
  | "token_exchange_failed"
  | "account_lookup_failed"
  | "missing_refresh_token"
  | "missing_scope"
  | "database_error"
  | "token_storage_failed";

export class GmailOAuthError extends Error {
  constructor(public readonly safeCode: GmailOAuthErrorCode) {
    super(safeCode);
    this.name = "GmailOAuthError";
  }
}

export function createOAuthClient() {
  const config = gmailConfig();
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

export async function createAuthorizationUrl(userId: string) {
  const state = randomBytes(32).toString("base64url");
  await prisma.externalOAuthState.create({
    data: {
      userId,
      provider: "gmail",
      stateHash: hashState(state),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent select_account",
    scope: [GMAIL_SCOPE, "openid", "email"],
    state,
  });
}

export async function consumeOAuthState(state: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const saved = await tx.externalOAuthState.findUnique({ where: { stateHash: hashState(state) } });
      if (!saved || saved.usedAt || saved.expiresAt <= new Date()) throw new GmailOAuthError("invalid_state");
      const consumed = await tx.externalOAuthState.updateMany({
        where: { id: saved.id, usedAt: null }, data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) throw new GmailOAuthError("invalid_state");
      return saved;
    });
  } catch (error) {
    if (error instanceof GmailOAuthError) throw error;
    throw new GmailOAuthError("database_error");
  }
}

export async function completeAuthorization(code: string, state: string) {
  const savedState = await consumeOAuthState(state);
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code).catch(() => { throw new GmailOAuthError("token_exchange_failed"); });
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" }).catch(() => { throw new GmailOAuthError("account_lookup_failed"); });
  const email = profile.data.emailAddress?.trim().toLowerCase();
  if (!email) throw new GmailOAuthError("account_lookup_failed");
  const existing = await prisma.externalConnection.findUnique({
    where: { userId_provider: { userId: savedState.userId, provider: "gmail" } },
  }).catch(() => { throw new GmailOAuthError("database_error"); });
  let existingRefreshToken: string | null = null;
  if (existing?.encryptedRefreshToken) {
    try { existingRefreshToken = decryptGmailToken(existing.encryptedRefreshToken); }
    catch { throw new GmailOAuthError("token_storage_failed"); }
  }
  if (!existingRefreshToken) {
    const driveConnection = await prisma.externalConnection.findUnique({
      where: { userId_provider: { userId: savedState.userId, provider: "google_drive" } },
    }).catch(() => { throw new GmailOAuthError("database_error"); });
    if (
      driveConnection?.status === "connected"
      && driveConnection.providerEmail.toLowerCase() === email
      && driveConnection.encryptedRefreshToken
    ) {
      try { existingRefreshToken = decryptGmailToken(driveConnection.encryptedRefreshToken); }
      catch { throw new GmailOAuthError("token_storage_failed"); }
    }
  }
  const refreshToken = tokens.refresh_token ?? existingRefreshToken;
  if (!refreshToken) throw new GmailOAuthError("missing_refresh_token");
  const scopes = (tokens.scope ?? GMAIL_SCOPE).split(" ").filter(Boolean);
  if (!scopes.includes(GMAIL_SCOPE)) throw new GmailOAuthError("missing_scope");
  let encryptedRefreshToken: string;
  try { encryptedRefreshToken = encryptGmailToken(refreshToken); }
  catch { throw new GmailOAuthError("token_storage_failed"); }
  return prisma.externalConnection.upsert({
    where: { userId_provider: { userId: savedState.userId, provider: "gmail" } },
    create: {
      userId: savedState.userId, provider: "gmail", providerAccountId: email,
      providerEmail: email, encryptedRefreshToken, grantedScopes: scopes,
    },
    update: {
      providerAccountId: email, providerEmail: email, encryptedRefreshToken,
      grantedScopes: scopes, status: "connected",
    },
  }).catch(() => { throw new GmailOAuthError("database_error"); });
}

export async function authorizedGmail(userId: string) {
  const connection = await prisma.externalConnection.findUnique({
    where: { userId_provider: { userId, provider: "gmail" } },
  });
  if (!connection || connection.status !== "connected") throw Object.assign(new Error("Gmail is not connected."), { statusCode: 409 });
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: decryptGmailToken(connection.encryptedRefreshToken) });
  return { connection, client, gmail: google.gmail({ version: "v1", auth: client }) };
}

export async function markGmailDisconnectedOnAuthFailure(userId: string, error: unknown) {
  const message = String((error as { message?: unknown }).message ?? error).toLowerCase();
  const status = (error as { code?: unknown; response?: { status?: unknown } }).response?.status;
  if (!message.includes("invalid_grant") && !message.includes("unauthorized") && status !== 401) return;
  await prisma.externalConnection.updateMany({
    where: { userId, provider: "gmail" },
    data: { status: "disconnected", encryptedRefreshToken: "", scanStartedAt: null },
  });
}
