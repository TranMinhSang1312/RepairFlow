import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";

import type {
  ObjectStoragePort,
  PresignPutInput,
  StoredObjectMetadata,
} from "./object-storage.port.js";

@Injectable()
export class S3ObjectStorageService implements ObjectStoragePort {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor() {
    const environment = parseApiEnvironment(process.env);
    this.bucket = environment.OBJECT_STORAGE_BUCKET;
    this.client = new S3Client({
      endpoint: environment.OBJECT_STORAGE_ENDPOINT,
      region: environment.OBJECT_STORAGE_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY,
        secretAccessKey: environment.OBJECT_STORAGE_SECRET_KEY,
      },
    });
  }

  presignPut(input: PresignPutInput): Promise<string> {
    const expiresIn = Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000));
    const metadata = input.checksumSha256 ? { "checksum-sha256": input.checksumSha256 } : undefined;
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        ContentType: input.mimeType,
        ContentLength: input.byteSize,
        ...(metadata ? { Metadata: metadata } : {}),
      }),
      { expiresIn },
    );
  }

  async head(objectKey: string): Promise<StoredObjectMetadata | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return {
        byteSize: response.ContentLength ?? 0,
        mimeType: response.ContentType ?? null,
        checksumSha256: response.Metadata?.["checksum-sha256"] ?? null,
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        (error.name === "NotFound" || error.name === "NoSuchKey")
      ) {
        return null;
      }
      throw error;
    }
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }
}
