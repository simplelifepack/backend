export type UploadObjectInput = {
  key: string;
  body: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
};

export type StoredObject = {
  key: string;
  bucket?: string;
  sizeBytes: number;
};

export interface StorageProvider {
  upload(input: UploadObjectInput): Promise<StoredObject>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getSignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = "StorageObjectNotFoundError";
  }
}
