import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  CONTENT_ALGORITHM,
  ENCRYPTION_VERSION,
  KEY_ALGORITHM,
  decryptHybridDocument,
  encryptDocumentOnBackend,
  getPublicDocumentEncryptionKey,
  resetDocumentEncryptionKeysForTests,
  rewrapDocumentAesKey,
  validateEncryptedDocumentEnvelope,
  verifyAndDecryptEnvelope,
} from "./documentHybridEncryption";
import { loadDocumentEncryptionKeys } from "./documentEncryptionKeyring";

function keyPair(keyId: string, keyVersion: number) {
  const pair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    keyId,
    keyVersion,
    publicKeyPem: pair.publicKey,
    privateKeyPem: pair.privateKey,
  };
}

function configureKeys(keys: ReturnType<typeof keyPair>[], active: ReturnType<typeof keyPair>) {
  process.env.DOCUMENT_RSA_KEYRING_JSON = JSON.stringify(keys);
  process.env.DOCUMENT_RSA_ACTIVE_KEY_ID = active.keyId;
  process.env.DOCUMENT_RSA_ACTIVE_KEY_VERSION = String(active.keyVersion);
  resetDocumentEncryptionKeysForTests();
}

function multipartFields(envelope: ReturnType<typeof encryptDocumentOnBackend>) {
  return {
    wrappedKey: envelope.wrappedKey,
    iv: envelope.iv,
    encryptionVersion: String(envelope.encryptionVersion),
    keyId: envelope.keyId,
    keyVersion: String(envelope.keyVersion),
    contentAlgorithm: envelope.contentAlgorithm,
    keyAlgorithm: envelope.keyAlgorithm,
    originalFilename: envelope.originalFilename,
    originalMimeType: envelope.originalMimeType,
    originalSize: String(envelope.originalSize),
    originalSha256: envelope.originalSha256,
    encryptedSha256: envelope.encryptedSha256,
    aiAnalysisConsent: "false",
  };
}

function encryptedFile(ciphertext: Buffer): Express.Multer.File {
  return {
    fieldname: "encryptedFile",
    originalname: "document.bin",
    encoding: "7bit",
    mimetype: "application/octet-stream",
    size: ciphertext.length,
    buffer: ciphertext,
  } as Express.Multer.File;
}

async function run() {
  const oldKey = keyPair("lifepack-old", 1);
  const newKey = keyPair("lifepack-new", 2);
  configureKeys([oldKey, newKey], oldKey);

  const plaintext = Buffer.from("authenticated document bytes");
  const encrypted = encryptDocumentOnBackend(plaintext, {
    filename: "document.pdf",
    mimeType: "application/pdf",
  });
  assert.equal(encrypted.contentAlgorithm, CONTENT_ALGORITHM);
  assert.equal(encrypted.keyAlgorithm, KEY_ALGORITHM);
  assert.equal(encrypted.encryptionVersion, ENCRYPTION_VERSION);
  const publicKey = getPublicDocumentEncryptionKey();
  assert.equal(publicKey.keyId, oldKey.keyId);
  assert.equal("privateKeyPem" in publicKey, false);

  const validated = validateEncryptedDocumentEnvelope(
    multipartFields(encrypted),
    encryptedFile(encrypted.ciphertext),
  );
  assert.deepEqual(verifyAndDecryptEnvelope(validated), plaintext);

  const modifiedCiphertext = Buffer.from(encrypted.ciphertext);
  modifiedCiphertext[0] ^= 1;
  await assert.rejects(
    async () =>
      validateEncryptedDocumentEnvelope(
        multipartFields(encrypted),
        encryptedFile(modifiedCiphertext),
      ),
    /hash does not match/,
  );

  const forgedHashFields = {
    ...multipartFields(encrypted),
    encryptedSha256: crypto.createHash("sha256").update(modifiedCiphertext).digest("hex"),
  };
  const forged = validateEncryptedDocumentEnvelope(
    forgedHashFields,
    encryptedFile(modifiedCiphertext),
  );
  assert.throws(() => verifyAndDecryptEnvelope(forged), /failed authentication/);

  const changedIv = {
    ...multipartFields(encrypted),
    iv: crypto.randomBytes(12).toString("base64url"),
  };
  assert.throws(
    () =>
      verifyAndDecryptEnvelope(
        validateEncryptedDocumentEnvelope(changedIv, encryptedFile(encrypted.ciphertext)),
      ),
    /failed authentication/,
  );
  const changedWrappedKey = {
    ...multipartFields(encrypted),
    wrappedKey: crypto.randomBytes(512).toString("base64url"),
  };
  assert.throws(
    () =>
      verifyAndDecryptEnvelope(
        validateEncryptedDocumentEnvelope(changedWrappedKey, encryptedFile(encrypted.ciphertext)),
      ),
    /key could not be verified/,
  );
  assert.throws(
    () =>
      validateEncryptedDocumentEnvelope(
        { ...multipartFields(encrypted), iv: crypto.randomBytes(11).toString("base64url") },
        encryptedFile(encrypted.ciphertext),
      ),
    /IV is invalid/,
  );

  assert.throws(
    () =>
      validateEncryptedDocumentEnvelope(
        { ...multipartFields(encrypted), keyVersion: "999" },
        encryptedFile(encrypted.ciphertext),
      ),
    /key version is not supported/,
  );

  configureKeys([oldKey, newKey], newKey);
  const rewrapped = rewrapDocumentAesKey(encrypted);
  assert.equal(rewrapped.keyId, newKey.keyId);
  assert.deepEqual(
    decryptHybridDocument(encrypted.ciphertext, {
      ...rewrapped,
      iv: encrypted.iv,
    }),
    plaintext,
  );

  const developmentKey = keyPair("lifepack-development", 1);
  assert.throws(
    () => loadDocumentEncryptionKeys({
      NODE_ENV: "production",
      DOCUMENT_RSA_KEYRING_JSON: JSON.stringify([developmentKey]),
    }),
    /development document key cannot be used in production/,
  );

  console.log("document hybrid encryption tests passed");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
