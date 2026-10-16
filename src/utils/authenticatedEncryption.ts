import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function sealAuthenticated(plaintext: Buffer, key: Buffer, aad?: Buffer) {
  if (key.length !== 32) throw new Error("Invalid encryption key.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

export function openAuthenticated(input: { iv: Buffer; tag: Buffer; data: Buffer }, key: Buffer, aad?: Buffer) {
  if (key.length !== 32 || input.iv.length !== 12 || input.tag.length !== 16) throw new Error("Invalid encryption envelope.");
  const decipher = createDecipheriv("aes-256-gcm", key, input.iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(input.tag);
  return Buffer.concat([decipher.update(input.data), decipher.final()]);
}
