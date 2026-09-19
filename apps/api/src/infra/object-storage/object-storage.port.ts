export const OBJECT_STORAGE = Symbol("repairflow.object-storage");

export interface PresignPutInput {
  objectKey: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string | null;
  expiresAt: Date;
}

export interface StoredObjectMetadata {
  byteSize: number;
  mimeType: string | null;
  checksumSha256: string | null;
}

export interface ObjectStoragePort {
  presignPut(input: PresignPutInput): Promise<string>;
  head(objectKey: string): Promise<StoredObjectMetadata | null>;
  delete(objectKey: string): Promise<void>;
}
