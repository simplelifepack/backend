import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  StorageObjectNotFoundError,
  type StorageProvider,
  type StoredObject,
  type UploadObjectInput,
} from "./StorageProvider";

export class LocalStorageProvider implements StorageProvider {
  readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
  }

  private resolveKey(key: string) {
    if (!key || key.includes("\0") || path.isAbsolute(key)) {
      throw new Error("Invalid storage key.");
    }
    const normalized = key.replace(/\\/g, "/");
    const resolved = path.resolve(this.basePath, normalized);
    if (resolved === this.basePath || !resolved.startsWith(`${this.basePath}${path.sep}`)) {
      throw new Error("Storage key escapes the configured storage directory.");
    }
    return resolved;
  }

  async upload(input: UploadObjectInput): Promise<StoredObject> {
    const destination = this.resolveKey(input.key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, input.body, { flag: "wx" });
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return { key: input.key, sizeBytes: input.body.length };
  }

  async download(key: string) {
    try {
      return await fs.readFile(this.resolveKey(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string) {
    await fs.rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string) {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async getSignedDownloadUrl(key: string) {
    this.resolveKey(key);
    return `/documents/download?storageKey=${encodeURIComponent(key)}`;
  }
}
