import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadStorageConfig } from "../../config/storage";
import { LocalStorageProvider } from "./LocalStorageProvider";
import { S3CompatibleStorageProvider } from "./S3CompatibleStorageProvider";
import { createStorageProvider } from "./createStorageProvider";
import { StorageObjectNotFoundError } from "./StorageProvider";
import type { StorageProvider } from "./StorageProvider";
import { DocumentStorageService } from "../../services/DocumentStorageService";

async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lifepack-storage-"));
  try {
    const provider = new LocalStorageProvider(directory);
    const key = "users/user-1/documents/doc-1/document.lpe";
    const bytes = Buffer.from("encrypted-test-bytes");
    await provider.upload({ key, body: bytes });
    assert.equal(await provider.exists(key), true);
    assert.deepEqual(await provider.download(key), bytes);
    await provider.delete(key);
    assert.equal(await provider.exists(key), false);
    await assert.rejects(() => provider.download(key), StorageObjectNotFoundError);
    await assert.rejects(() => provider.upload({ key: "../escape", body: bytes }), /escapes/);
    await assert.rejects(() => provider.download(path.resolve(directory, "absolute")), /Invalid storage key/);

    const localConfig = loadStorageConfig({
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_PATH: directory,
    });
    assert.ok(createStorageProvider(localConfig) instanceof LocalStorageProvider);

    const s3Config = loadStorageConfig({
      STORAGE_DRIVER: "s3",
      STORAGE_REGION: "ap-south-1",
      STORAGE_BUCKET: "private-test-bucket",
      STORAGE_ACCESS_KEY_ID: "test-access",
      STORAGE_SECRET_ACCESS_KEY: "test-secret",
      STORAGE_FORCE_PATH_STYLE: "true",
    });
    assert.ok(createStorageProvider(s3Config) instanceof S3CompatibleStorageProvider);
    assert.throws(() => loadStorageConfig({ STORAGE_DRIVER: "unsupported" }), /Unsupported storage driver/);
    assert.throws(
      () => loadStorageConfig({ STORAGE_DRIVER: "local", STORAGE_REGION: "unused" }),
      /LOCAL_STORAGE_PATH/,
    );
    assert.throws(
      () => loadStorageConfig({ STORAGE_DRIVER: "s3", LOCAL_STORAGE_PATH: directory }),
      /STORAGE_REGION/,
    );

    const objects = new Map<string, Buffer>();
    const contentTypes = new Map<string, string | undefined>();
    const mockStorage: StorageProvider = {
      async upload(input) {
        objects.set(input.key, input.body);
        contentTypes.set(input.key, input.contentType);
        return { key: input.key, sizeBytes: input.body.length };
      },
      async download(objectKey) {
        const object = objects.get(objectKey);
        if (!object) throw new StorageObjectNotFoundError(objectKey);
        return object;
      },
      async delete(objectKey) {
        objects.delete(objectKey);
      },
      async exists(objectKey) {
        return objects.has(objectKey);
      },
      async getSignedDownloadUrl(objectKey) {
        return `/mock/${objectKey}`;
      },
    };
    const documentStorage = new DocumentStorageService(mockStorage);
    await documentStorage.uploadEncrypted({ key, plaintext: bytes });
    assert.equal(objects.get(key)?.includes(bytes), false);
    assert.deepEqual(await documentStorage.downloadDecrypted(key), bytes);
    await documentStorage.delete(key);
    assert.equal(objects.has(key), false);
    await documentStorage.uploadCiphertext({
      key,
      ciphertext: bytes,
      metadata: { encryptionVersion: "1" },
    });
    assert.deepEqual(objects.get(key), bytes);
    assert.equal(contentTypes.get(key), "application/octet-stream");
    await documentStorage.delete(key);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
  console.log("Storage portability tests passed.");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
