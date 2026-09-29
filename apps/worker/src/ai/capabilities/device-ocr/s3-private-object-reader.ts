import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { PrivateObjectReadResult, PrivateObjectReader } from "./device-ocr-media-loader.js";

export interface S3PrivateObjectReaderOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3PrivateObjectReader implements PrivateObjectReader {
  private readonly client: S3Client;

  constructor(private readonly options: S3PrivateObjectReaderOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async read(objectKey: string, maxBytes: number): Promise<PrivateObjectReadResult> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
    );
    if (!response.Body || (response.ContentLength ?? maxBytes + 1) > maxBytes) {
      throw new Error("AI_MEDIA_UNAVAILABLE");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const rawChunk of response.Body as AsyncIterable<Uint8Array>) {
      const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error("AI_MEDIA_UNAVAILABLE");
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
      chunk.fill(0);
    }
    return {
      bytes,
      byteSize: response.ContentLength ?? size,
      mimeType: response.ContentType ?? null,
    };
  }
}
