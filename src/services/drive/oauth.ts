import { createHash, randomBytes } from "node:crypto";
import { google } from "googleapis";

import { prisma } from "../../lib/prisma";
import { decryptGmailToken, encryptGmailToken } from "../gmail/tokenEncryption";
import { DRIVE_SCOPE, driveConfig } from "./config";

const STATE_TTL_MS = 10 * 60 * 1000;
const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

export type DriveOAuthErrorCode =
  | "invalid_state"
  | "token_exchange_failed"
  | "account_lookup_failed"
  | "missing_refresh_token"
  | "missing_scope"
  | "database_error"
  | "token_storage_failed";

export class DriveOAuthError extends Error {
  constructor(public readonly safeCode: DriveOAuthErrorCode) {
    super(safeCode);
    this.name = "DriveOAuthError";
  }
}

export function createDriveOAuthClient() {
  const config = driveConfig();
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

export async function createDriveAuthorizationUrl(userId: string, loginHint?: string) {
  const state = randomBytes(32).toString("base64url");
  await prisma.externalOAuthState.create({
    data: { userId, provider: "google_drive", stateHash: hashState(state), expiresAt: new Date(Date.now() + STATE_TTL_MS) },
  });
  return createDriveOAuthClient().generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    scope: [DRIVE_SCOPE],
    state,
    login_hint: loginHint,
  });
}

async function consumeState(state: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const saved = await tx.externalOAuthState.findUnique({ where: { stateHash: hashState(state) } });
      if (!saved || saved.provider !== "google_drive" || saved.usedAt || saved.expiresAt <= new Date()) throw new DriveOAuthError("invalid_state");
      const consumed = await tx.externalOAuthState.updateMany({ where: { id: saved.id, usedAt: null }, data: { usedAt: new Date() } });
      if (consumed.count !== 1) throw new DriveOAuthError("invalid_state");
      return saved;
    });
  } catch (error) {
    if (error instanceof DriveOAuthError) throw error;
    throw new DriveOAuthError("database_error");
  }
}

export async function completeDriveAuthorization(code: string, state: string) {
  const saved = await consumeState(state);
  const client = createDriveOAuthClient();
  const { tokens } = await client.getToken(code).catch(() => { throw new DriveOAuthError("token_exchange_failed"); });
  client.setCredentials(tokens);
  const user = await prisma.user.findUnique({ where: { id: saved.userId }, select: { email: true } })
    .catch(() => { throw new DriveOAuthError("database_error"); });
  const email = user?.email.trim().toLowerCase();
  if (!email) throw new DriveOAuthError("account_lookup_failed");
  const accountId = email;
  const existing = await prisma.externalConnection.findUnique({
    where: { userId_provider: { userId: saved.userId, provider: "google_drive" } },
  }).catch(() => { throw new DriveOAuthError("database_error"); });
  const priorToken = (() => {
    try { return existing?.encryptedRefreshToken ? decryptGmailToken(existing.encryptedRefreshToken) : null; }
    catch { throw new DriveOAuthError("token_storage_failed"); }
  })();
  let sharedToken: string | null = null;
  if (!priorToken) {
    const gmailConnection = await prisma.externalConnection.findUnique({
      where: { userId_provider: { userId: saved.userId, provider: "gmail" } },
    }).catch(() => { throw new DriveOAuthError("database_error"); });
    if (
      gmailConnection?.status === "connected"
      && gmailConnection.providerEmail.toLowerCase() === email
      && gmailConnection.encryptedRefreshToken
    ) {
      try { sharedToken = decryptGmailToken(gmailConnection.encryptedRefreshToken); }
      catch { throw new DriveOAuthError("token_storage_failed"); }
    }
  }
  const refreshToken = tokens.refresh_token ?? priorToken ?? sharedToken;
  if (!refreshToken) throw new DriveOAuthError("missing_refresh_token");
  const scopes = (tokens.scope ?? DRIVE_SCOPE).split(" ").filter(Boolean);
  if (!scopes.includes(DRIVE_SCOPE)) throw new DriveOAuthError("missing_scope");
  let encryptedRefreshToken: string;
  try { encryptedRefreshToken = encryptGmailToken(refreshToken); }
  catch { throw new DriveOAuthError("token_storage_failed"); }
  return prisma.externalConnection.upsert({
    where: { userId_provider: { userId: saved.userId, provider: "google_drive" } },
    create: {
      userId: saved.userId, provider: "google_drive", providerAccountId: accountId,
      providerEmail: email, encryptedRefreshToken, grantedScopes: scopes,
    },
    update: {
      providerAccountId: accountId, providerEmail: email, encryptedRefreshToken,
      grantedScopes: scopes, status: "connected", lastScanError: null,
    },
  }).catch(() => { throw new DriveOAuthError("database_error"); });
}

export async function authorizedDrive(userId: string) {
  const connection = await prisma.externalConnection.findUnique({
    where: { userId_provider: { userId, provider: "google_drive" } },
  });
  if (!connection || connection.status !== "connected") throw Object.assign(new Error("Google Drive is not connected."), { statusCode: 409 });
  const client = createDriveOAuthClient();
  client.setCredentials({ refresh_token: decryptGmailToken(connection.encryptedRefreshToken) });
  return { connection, client, drive: google.drive({ version: "v3", auth: client }) };
}

export async function markDriveDisconnectedOnAuthFailure(userId: string, error: unknown) {
  const message = String((error as { message?: unknown }).message ?? error).toLowerCase();
  const status = (error as { response?: { status?: unknown } }).response?.status;
  if (!message.includes("invalid_grant") && !message.includes("unauthorized") && status !== 401) return;
  await prisma.externalConnection.updateMany({
    where: { userId, provider: "google_drive" },
    data: { status: "disconnected", encryptedRefreshToken: "", scanStartedAt: null, scanPhase: null },
  });
}
