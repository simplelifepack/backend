import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function key() {
  const configured = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is required.");
  const raw = configured.startsWith("base64:")
    ? Buffer.from(configured.slice(7), "base64")
    : Buffer.from(configured, "base64");
  if (raw.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
  return raw;
}

export function encryptGmailToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptGmailToken(encrypted: string) {
  const [version, iv, tag, data] = encrypted.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Encrypted Gmail token is invalid.");
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function assertGmailTokenEncryptionConfigured() {
  key();
}
