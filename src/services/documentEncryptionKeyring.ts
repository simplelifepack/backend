import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  KEY_ALGORITHM,
  type DocumentEncryptionKey,
} from "./documentEncryptionConstants";

function parsePem(value: string | undefined, name: string) {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required.`);
  if (trimmed.startsWith("base64:")) {
    return Buffer.from(trimmed.slice("base64:".length), "base64").toString("utf8");
  }
  return trimmed.replace(/\\n/g, "\n");
}

const DEVELOPMENT_KEY_ID = "lifepack-development";
const DEVELOPMENT_KEY_VERSION = 1;

function developmentKey(): DocumentEncryptionKey {
  const directory = path.resolve(process.cwd(), ".secrets");
  const publicKeyPath = path.join(directory, "document-rsa-public.pem");
  const privateKeyPath = path.join(directory, "document-rsa-private.pem");
  const publicExists = fs.existsSync(publicKeyPath);
  const privateExists = fs.existsSync(privateKeyPath);
  if (publicExists !== privateExists) {
    throw new Error("The local document RSA key pair is incomplete. Restore or remove both .secrets key files.");
  }
  if (!publicExists) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const generated = crypto.generateKeyPairSync("rsa", {
      modulusLength: 4096,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    fs.writeFileSync(privateKeyPath, generated.privateKey, { flag: "wx", mode: 0o600 });
    fs.writeFileSync(publicKeyPath, generated.publicKey, { flag: "wx", mode: 0o644 });
  }
  return {
    keyId: DEVELOPMENT_KEY_ID,
    keyVersion: DEVELOPMENT_KEY_VERSION,
    algorithm: KEY_ALGORITHM,
    publicKeyPem: fs.readFileSync(publicKeyPath, "utf8"),
    privateKeyPem: fs.readFileSync(privateKeyPath, "utf8"),
  };
}

function assertRsa4096Key(key: DocumentEncryptionKey) {
  const publicKey = crypto.createPublicKey(key.publicKeyPem);
  const privateKey = crypto.createPrivateKey(key.privateKeyPem);
  if (
    publicKey.asymmetricKeyType !== "rsa" ||
    privateKey.asymmetricKeyType !== "rsa" ||
    publicKey.asymmetricKeyDetails?.modulusLength !== 4096 ||
    privateKey.asymmetricKeyDetails?.modulusLength !== 4096
  ) {
    throw new Error(`Document encryption key ${key.keyId} v${key.keyVersion} must be RSA-4096.`);
  }
  const publicFromPrivate = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const configuredPublic = publicKey.export({ type: "spki", format: "pem" });
  if (publicFromPrivate.toString() !== configuredPublic.toString()) {
    throw new Error(`Document encryption key ${key.keyId} v${key.keyVersion} does not match its private key.`);
  }
}

function keyFromEnvironment(env: NodeJS.ProcessEnv): DocumentEncryptionKey {
  if (
    env.NODE_ENV !== "production" &&
    !env.DOCUMENT_RSA_PUBLIC_KEY?.trim() &&
    !env.DOCUMENT_RSA_PRIVATE_KEY?.trim()
  ) {
    return developmentKey();
  }
  return {
    keyId: env.DOCUMENT_RSA_ACTIVE_KEY_ID?.trim() || "",
    keyVersion: Number(env.DOCUMENT_RSA_ACTIVE_KEY_VERSION),
    algorithm: KEY_ALGORITHM,
    publicKeyPem: parsePem(env.DOCUMENT_RSA_PUBLIC_KEY, "DOCUMENT_RSA_PUBLIC_KEY"),
    privateKeyPem: parsePem(env.DOCUMENT_RSA_PRIVATE_KEY, "DOCUMENT_RSA_PRIVATE_KEY"),
  };
}

let cachedKeys: DocumentEncryptionKey[] | undefined;

export function loadDocumentEncryptionKeys(env: NodeJS.ProcessEnv = process.env) {
  if (env === process.env && cachedKeys) return cachedKeys;
  let keys: DocumentEncryptionKey[];
  if (env.DOCUMENT_RSA_KEYRING_JSON?.trim()) {
    const parsed = z.array(z.object({
      keyId: z.string().trim().min(1),
      keyVersion: z.number().int().positive(),
      publicKeyPem: z.string().min(1),
      privateKeyPem: z.string().min(1),
    }).strict()).min(1).parse(JSON.parse(env.DOCUMENT_RSA_KEYRING_JSON));
    keys = parsed.map((key) => ({ ...key, algorithm: KEY_ALGORITHM }));
  } else {
    keys = [keyFromEnvironment(env)];
  }
  for (const key of keys) {
    if (!key.keyId || !Number.isInteger(key.keyVersion) || key.keyVersion < 1) {
      throw new Error("Each document RSA key requires a keyId and positive keyVersion.");
    }
    assertRsa4096Key(key);
    const deploymentEnvironment = (env.APP_ENV || env.NODE_ENV || "development").toLowerCase();
    if (deploymentEnvironment !== "development" && key.keyId === DEVELOPMENT_KEY_ID) {
      throw new Error(`The development document key cannot be used in ${deploymentEnvironment}.`);
    }
    if (deploymentEnvironment === "production" && !/prod(?:uction)?/i.test(key.keyId)) {
      throw new Error("Production document encryption requires a production key identifier or KMS-backed key provider.");
    }
    if (deploymentEnvironment === "staging" && !/stag(?:e|ing)/i.test(key.keyId)) {
      throw new Error("Staging document encryption requires a staging key identifier.");
    }
  }
  const references = new Set(keys.map((key) => `${key.keyId}:${key.keyVersion}`));
  if (references.size !== keys.length) throw new Error("Document RSA key references must be unique.");
  if (env === process.env) cachedKeys = keys;
  return keys;
}

export function resetDocumentEncryptionKeysForTests() {
  cachedKeys = undefined;
}

export function getActiveDocumentEncryptionKey(env: NodeJS.ProcessEnv = process.env) {
  const keys = loadDocumentEncryptionKeys(env);
  const developmentDefaults = env.NODE_ENV !== "production" && keys.length === 1;
  const activeKeyId =
    env.DOCUMENT_RSA_ACTIVE_KEY_ID?.trim() ||
    (developmentDefaults ? keys[0]?.keyId : undefined);
  const configuredVersion = Number(env.DOCUMENT_RSA_ACTIVE_KEY_VERSION);
  const activeKeyVersion =
    Number.isInteger(configuredVersion) && configuredVersion > 0
      ? configuredVersion
      : developmentDefaults
        ? keys[0]?.keyVersion
        : undefined;
  const active = keys.find(
    (key) => key.keyId === activeKeyId && key.keyVersion === activeKeyVersion,
  );
  if (!active) throw new Error("The active document RSA key is not present in the configured keyring.");
  return active;
}

export function getPublicDocumentEncryptionKey() {
  const key = getActiveDocumentEncryptionKey();
  return {
    keyId: key.keyId,
    keyVersion: key.keyVersion,
    algorithm: key.algorithm,
    publicKeyPem: crypto.createPublicKey(key.publicKeyPem).export({
      type: "spki",
      format: "pem",
    }).toString(),
  };
}
