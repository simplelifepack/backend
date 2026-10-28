import { Readable } from "node:stream";
import fs from "node:fs/promises";
import { createHmac, hkdfSync, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { openAuthenticated, sealAuthenticated } from "../utils/authenticatedEncryption";

// Reuses the document encryption implementation's AES-256-GCM, with a new,
// deliberately incompatible version for authenticated contextual binding.
const PREFIX = "enc:v2:";
const MAX_ENVELOPE_BYTES = 512 * 1024 * 1024;
export type FieldBinding = Readonly<{ model: string; recordId: string; ownerId: string; field: string }>;

function failure(): never { throw new Error("PRIVATE_DATA_UNAVAILABLE"); }

function decodeKey(value: string): Buffer {
  if (!/^base64:[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("Privacy keys must be base64: followed by exactly 32 random bytes.");
  const result = Buffer.from(value.slice(7), "base64");
  if (result.length !== 32 || `base64:${result.toString("base64")}` !== value) throw new Error("Invalid privacy key configuration.");
  return result;
}

function keyring() {
  let parsed: unknown;
  try { parsed = JSON.parse(process.env.PRIVATE_DATA_KEYRING_JSON || "{}"); }
  catch { throw new Error("Invalid privacy key configuration."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid privacy key configuration.");
  const entries = Object.entries(parsed as Record<string, unknown>);
  const keys = new Map<string, Buffer>();
  for (const [id, value] of entries) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof value !== "string") throw new Error("Invalid privacy key configuration.");
    keys.set(id, decodeKey(value));
  }
  const active = process.env.PRIVATE_DATA_ACTIVE_KEY_ID || "";
  if (!keys.has(active)) throw new Error("The active privacy key must be configured outside the database.");
  return { active, keys };
}

function bindingText(binding: FieldBinding) {
  const values = [binding.model, binding.recordId, binding.ownerId, binding.field];
  if (values.some(value => typeof value !== "string" || !value.length)) throw new Error("A complete private field binding is required.");
  return JSON.stringify(values);
}

function derive(key: Buffer, purpose: string) {
  return Buffer.from(hkdfSync("sha256", key, "readiness-private-data-v2", purpose, 32));
}

export function assertPrivateDataKeysConfigured() {
  const ring = keyring();
  const lookup = decodeKey(process.env.PRIVATE_DATA_LOOKUP_KEY || "");
  if ([...ring.keys.values()].some(key => key.equals(lookup))) throw new Error("Privacy lookup and encryption keys must be distinct.");
}
export function isPrivateCiphertext(value: unknown): value is string { return typeof value === "string" && value.startsWith(PREFIX); }

export function encryptPrivateBytes(value: Buffer, binding: FieldBinding): string {
  const context = bindingText(binding);
  assertPrivateDataKeysConfigured();
  const { active, keys } = keyring();
  if (value.length > MAX_ENVELOPE_BYTES) throw new Error("Private value exceeds the supported size.");
  const encrypted = sealAuthenticated(value, derive(keys.get(active)!, `encryption:${binding.model}:${binding.field}`), Buffer.from(JSON.stringify([2, active, context])));
  return PREFIX + [active, encrypted.iv.toString("base64url"), encrypted.tag.toString("base64url"), encrypted.data.toString("base64url")].join(":");
}

export function decryptPrivateBytes(value: string, binding: FieldBinding): Buffer {
  const context = bindingText(binding);
  try {
    if (!isPrivateCiphertext(value) || value.length > MAX_ENVELOPE_BYTES * 2) return failure();
    const parts = value.slice(PREFIX.length).split(":");
    if (parts.length !== 4) return failure();
    const [id, iv, tag, data] = parts;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^[A-Za-z0-9_-]{16}$/.test(iv) || !/^[A-Za-z0-9_-]{22}$/.test(tag) || !/^[A-Za-z0-9_-]*$/.test(data)) return failure();
    const key = keyring().keys.get(id);
    if (!key) return failure();
    const nonce = Buffer.from(iv, "base64url"), authTag = Buffer.from(tag, "base64url"), encrypted = Buffer.from(data, "base64url");
    if (nonce.toString("base64url") !== iv || authTag.toString("base64url") !== tag || encrypted.toString("base64url") !== data) return failure();
    return openAuthenticated({ iv: nonce, tag: authTag, data: encrypted }, derive(key, `encryption:${binding.model}:${binding.field}`), Buffer.from(JSON.stringify([2, id, context])));
  } catch { return failure(); }
}

export function encryptPrivateValue(value: unknown, binding: FieldBinding): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Undefined private data cannot be persisted.");
  const plaintext = Buffer.from(serialized);
  try { return encryptPrivateBytes(plaintext, binding); }
  finally { plaintext.fill(0); }
}

export function decryptPrivateValue<T>(value: string, binding: FieldBinding): T {
  const plaintext = decryptPrivateBytes(value, binding);
  try { return JSON.parse(plaintext.toString("utf8")) as T; }
  catch { return failure(); }
  finally { plaintext.fill(0); }
}

// Lookup key is independently provisioned and stable across encryption-key rotation.
// Equality leakage is intentional; include ownerId except for global auth uniqueness.
export function privateLookup(value: unknown, scope: { model: string; field: string; ownerId: string }): string {
  const key = decodeKey(process.env.PRIVATE_DATA_LOOKUP_KEY || "");
  const input = JSON.stringify([2, scope.model, scope.field, scope.ownerId, value]);
  return "hmac:v2:" + createHmac("sha256", derive(key, "lookup")).update(input).digest("hex");
}

// Streaming counterpart of encryptPrivateBytes: same enc:v2 envelope and AAD.
// Only ciphertext is written to disk. The fixed-length tag placeholder is
// replaced after finalization; callers publish the file only after completion.
export async function encryptPrivateStreamToFile(source: AsyncIterable<Uint8Array>, binding: FieldBinding, filePath: string) {
  assertPrivateDataKeysConfigured();
  const { active, keys } = keyring();
  const key = derive(keys.get(active)!, `encryption:${binding.model}:${binding.field}`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify([2, active, bindingText(binding)])));
  const prefix = `${PREFIX}${active}:${iv.toString("base64url")}:`;
  const handle = await fs.open(filePath, "wx", 0o600);
  let carry = Buffer.alloc(0), sizeBytes = 0;
  const writeAll = async (value: string | Buffer, position?: number) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let offset = 0;
    while (offset < bytes.length) {
      const written = await handle.write(bytes, offset, bytes.length - offset, position === undefined ? null : position + offset);
      if (!written.bytesWritten) throw new Error("Encrypted archive write failed.");
      offset += written.bytesWritten;
    }
  };
  const writeCiphertext = async (bytes: Buffer) => {
    const combined = carry.length ? Buffer.concat([carry, bytes]) : bytes;
    const count = combined.length - combined.length % 3;
    if (count) await writeAll(combined.subarray(0, count).toString("base64url"));
    carry = Buffer.from(combined.subarray(count));
  };
  try {
    await writeAll(`${prefix}${"_".repeat(22)}:`);
    for await (const chunk of source) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > MAX_ENVELOPE_BYTES) throw new Error("Private value exceeds the supported size.");
      await writeCiphertext(cipher.update(chunk));
    }
    await writeCiphertext(cipher.final());
    if (carry.length) await writeAll(carry.toString("base64url"));
    const tag = Buffer.from(cipher.getAuthTag().toString("base64url"));
    await writeAll(tag, Buffer.byteLength(prefix));
    return { sizeBytes };
  } catch (error) {
    await handle.close();
    await fs.rm(filePath, { force: true });
    throw error;
  } finally { key.fill(0); await handle.close(); }
}

// Authenticate the complete encrypted file before returning a readable stream.
// Two passes over the same private, read-only ciphertext descriptor avoid
// retaining/persisting a plaintext archive and prevent partial GCM output.
export async function openVerifiedPrivateFile(filePath: string, binding: FieldBinding, signal?: AbortSignal) {
  const handle = await fs.open(filePath, "r");
  let key: Buffer | undefined;
  let closing: Promise<void> | undefined;
  const dispose = () => closing ??= (async () => { key?.fill(0); await handle.close(); })();
  try {
    const stat = await handle.stat();
    if (stat.size > Math.ceil(MAX_ENVELOPE_BYTES * 4 / 3) + 256) failure();
    const header = Buffer.alloc(256);
    const read = await handle.read(header, 0, header.length, 0);
    const match = /^enc:v2:([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{16}):([A-Za-z0-9_-]{22}):/.exec(header.subarray(0, read.bytesRead).toString("utf8"));
    if (!match) failure();
    const secret = keyring().keys.get(match[1]);
    if (!secret) failure();
    key = derive(secret, `encryption:${binding.model}:${binding.field}`);
    const iv = Buffer.from(match[2], "base64url"), tag = Buffer.from(match[3], "base64url");
    if (iv.toString("base64url") !== match[2] || tag.toString("base64url") !== match[3]) failure();
    const aad = Buffer.from(JSON.stringify([2, match[1], bindingText(binding)]));
    async function* ciphertext() {
      let carry = "", position = match![0].length;
      const buffer = Buffer.alloc(64 * 1024);
      while (position < stat.size) {
        signal?.throwIfAborted();
        const read = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - position), position);
        if (!read.bytesRead) failure();
        position += read.bytesRead;
        const chunk = buffer.subarray(0, read.bytesRead).toString("utf8");
        if (!/^[A-Za-z0-9_-]*$/.test(chunk)) failure();
        carry += chunk;
        const size = carry.length - carry.length % 4;
        if (size) yield Buffer.from(carry.slice(0, size), "base64url");
        carry = carry.slice(size);
      }
      if (carry) {
        const bytes = Buffer.from(carry, "base64url");
        if (bytes.toString("base64url") !== carry) failure();
        yield bytes;
      }
    }
    const decipher = () => {
      const value = createDecipheriv("aes-256-gcm", key!, iv);
      value.setAAD(aad); value.setAuthTag(tag);
      return value;
    };
    const verify = decipher();
    for await (const chunk of ciphertext()) verify.update(chunk).fill(0);
    verify.final().fill(0);
    signal?.throwIfAborted();
    async function* plaintext() {
      const value = decipher();
      try {
        for await (const chunk of ciphertext()) {
          yield value.update(chunk);
        }
        const final = value.final();
        if (final.length) yield final;
      } finally { await dispose(); }
    }
    return { stream: Readable.from(plaintext()), dispose };
  } catch (error) { await dispose(); if (signal?.aborted) throw error; return failure(); }
}
