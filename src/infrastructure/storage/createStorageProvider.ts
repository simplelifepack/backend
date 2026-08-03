import { loadStorageConfig, type StorageConfig } from "../../config/storage";
import { LocalStorageProvider } from "./LocalStorageProvider";
import { S3CompatibleStorageProvider } from "./S3CompatibleStorageProvider";
import type { StorageProvider } from "./StorageProvider";

export function createStorageProvider(config: StorageConfig = loadStorageConfig()): StorageProvider {
  switch (config.driver) {
    case "local":
      return new LocalStorageProvider(config.localPath);
    case "s3":
      return new S3CompatibleStorageProvider(config);
  }
}

let provider: StorageProvider | undefined;

export function getStorageProvider() {
  provider ??= createStorageProvider();
  return provider;
}

export function resetStorageProviderForTests() {
  provider = undefined;
}
