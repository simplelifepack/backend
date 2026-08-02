import type { StorageProvider } from "../infrastructure/storage/StorageProvider";
import { decryptDocumentBuffer, encryptDocumentBuffer } from "../utils/documentEncryption";

export class DocumentStorageService {
  constructor(private readonly storage: StorageProvider) {}

  async uploadEncrypted(input: {
    key: string;
    plaintext: Buffer;
    contentType?: string;
  }) {
    return this.storage.upload({
      key: input.key,
      body: encryptDocumentBuffer(input.plaintext),
      contentType: "application/octet-stream",
      metadata: { encryptionVersion: "1" },
    });
  }

  async uploadCiphertext(input: {
    key: string;
    ciphertext: Buffer;
    metadata: Record<string, string>;
  }) {
    return this.storage.upload({
      key: input.key,
      body: input.ciphertext,
      contentType: "application/octet-stream",
      metadata: input.metadata,
    });
  }

  async downloadDecrypted(key: string) {
    return decryptDocumentBuffer(await this.storage.download(key));
  }

  async delete(key: string) {
    await this.storage.delete(key);
  }
}
