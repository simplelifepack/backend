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
