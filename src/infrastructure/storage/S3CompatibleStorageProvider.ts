import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { S3StorageConfig } from "../../config/storage";
import {
  StorageObjectNotFoundError,
  type StorageProvider,
  type UploadObjectInput,
} from "./StorageProvider";

function isNotFound(error: unknown) {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.name === "NotFound" || candidate?.name === "NoSuchKey" || candidate?.$metadata?.httpStatusCode === 404;
}

export class S3CompatibleStorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      // S3-compatible providers do not all implement optional AWS checksum
      // trailers. Keep known-length streaming PUTs compatible with Supabase.
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async upload(input: UploadObjectInput) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      Metadata: input.metadata,
    }));
    return { key: input.key, bucket: this.config.bucket, sizeBytes: input.body.length };
  }

  async uploadFile(input: Omit<UploadObjectInput, "body"> & { filePath: string }) {
    const sizeBytes = (await stat(input.filePath)).size;
    const body = createReadStream(input.filePath);
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: input.key, Body: body, ContentLength: sizeBytes, ContentType: input.contentType, Metadata: input.metadata }));
      return { key: input.key, bucket: this.config.bucket, sizeBytes };
    } finally { body.destroy(); }
  }

  async downloadFile(key: string, filePath: string, signal?: AbortSignal) {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: signal });
      if (!response.Body) throw new StorageObjectNotFoundError(key);
      await pipeline(response.Body as Readable, createWriteStream(filePath, { flags: "wx", mode: 0o600 }), { signal });
    } catch (error) { if (isNotFound(error)) throw new StorageObjectNotFoundError(key); throw error; }
  }

  async download(key: string) {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (!response.Body) throw new StorageObjectNotFoundError(key);
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) throw new StorageObjectNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async getSignedDownloadUrl(key: string, expiresInSeconds = 300) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
