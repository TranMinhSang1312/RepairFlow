import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

import type { AiGatewayImageInput } from "../../ai-gateway.js";
import { stripImageMetadata } from "./image-metadata.js";

const ALLOWED_MIME_TYPES = new Set<AiGatewayImageInput["mediaType"]>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type DeviceOcrMediaErrorCode = "AI_AUTHORIZATION_REVOKED" | "AI_MEDIA_UNAVAILABLE";

export class DeviceOcrMediaError extends Error {
  constructor(readonly code: DeviceOcrMediaErrorCode) {
    super(code);
    this.name = "DeviceOcrMediaError";
  }
}

export interface PrivateObjectReadResult {
  bytes: Uint8Array;
  byteSize: number;
  mimeType: string | null;
}

export interface PrivateObjectReader {
  read(objectKey: string, maxBytes: number): Promise<PrivateObjectReadResult>;
}

export interface LoadedDeviceOcrImage {
  image: AiGatewayImageInput;
  dispose(): void;
}

export class DeviceOcrMediaLoader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly objects: PrivateObjectReader,
    private readonly maxImageBytes: number,
  ) {}

  async load(input: {
    shopId: string;
    mediaAssetId: string;
    repairOrderId: string | null;
    now: Date;
  }): Promise<LoadedDeviceOcrImage> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: input.mediaAssetId, shopId: input.shopId },
    });
    if (!asset || asset.purpose !== "INTAKE" || asset.repairOrderId !== input.repairOrderId) {
      throw new DeviceOcrMediaError("AI_AUTHORIZATION_REVOKED");
    }
    const mediaType = asset.mimeType as AiGatewayImageInput["mediaType"];
    const provisionalComplete =
      asset.repairOrderId === null &&
      asset.uploadedAt === null &&
      asset.expiresAt !== null &&
      asset.expiresAt > input.now;
    const attachedComplete =
      asset.repairOrderId !== null && asset.uploadedAt !== null && asset.expiresAt === null;
    if (
      !ALLOWED_MIME_TYPES.has(mediaType) ||
      asset.byteSize < 1 ||
      asset.byteSize > this.maxImageBytes ||
      (!provisionalComplete && !attachedComplete)
    ) {
      throw new DeviceOcrMediaError("AI_AUTHORIZATION_REVOKED");
    }

    let stored: PrivateObjectReadResult;
    try {
      stored = await this.objects.read(asset.objectKey, this.maxImageBytes);
    } catch {
      throw new DeviceOcrMediaError("AI_MEDIA_UNAVAILABLE");
    }
    if (
      stored.byteSize !== asset.byteSize ||
      stored.mimeType !== asset.mimeType ||
      stored.bytes.byteLength !== asset.byteSize ||
      (asset.checksumSha256 !== null &&
        createHash("sha256").update(stored.bytes).digest("hex") !== asset.checksumSha256)
    ) {
      stored.bytes.fill(0);
      throw new DeviceOcrMediaError("AI_MEDIA_UNAVAILABLE");
    }
    let sanitized: Uint8Array;
    try {
      sanitized = stripImageMetadata(stored.bytes, mediaType);
    } catch {
      stored.bytes.fill(0);
      throw new DeviceOcrMediaError("AI_MEDIA_UNAVAILABLE");
    }
    stored.bytes.fill(0);
    const image: AiGatewayImageInput = {
      mediaType,
      base64Data: Buffer.from(sanitized).toString("base64"),
    };
    return {
      image,
      dispose: () => {
        sanitized.fill(0);
        image.base64Data = "";
      },
    };
  }
}
