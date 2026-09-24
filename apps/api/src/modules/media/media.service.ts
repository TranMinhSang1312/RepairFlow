/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor and storage tokens at runtime for DI. */

import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../../infra/object-storage/object-storage.port.js";
import type { PresignIntakeMediaDto, PresignOrderMediaDto } from "./media.dto.js";
import { MediaRepository } from "./media.repository.js";

const MAX_UPLOAD_BYTES = 15_000_000;
const UPLOAD_TTL_MS = 10 * 60 * 1000;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PresignMediaResponse {
  data: { mediaAssetId: string; uploadUrl: string; expiresAt: string };
}

@Injectable()
export class MediaService {
  constructor(
    private readonly repository: MediaRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async presignIntake(
    tenant: TenantContext,
    dto: PresignIntakeMediaDto,
  ): Promise<PresignMediaResponse> {
    this.assertUploadMetadata(dto);
    return this.createSignedAsset(tenant, dto, null);
  }

  async presignOrder(
    tenant: TenantContext,
    repairOrderId: string,
    dto: PresignOrderMediaDto,
  ): Promise<PresignMediaResponse> {
    if (!UUID_PATTERN.test(repairOrderId)) throw this.notFound();
    const orderId = repairOrderId.toLowerCase();
    if (!(await this.repository.findVisibleOrder(tenant, orderId))) throw this.notFound();
    this.assertUploadMetadata(dto);
    return this.createSignedAsset(tenant, dto, orderId);
  }

  private assertUploadMetadata(dto: PresignOrderMediaDto): void {
    if (!ALLOWED_MIME_TYPES.has(dto.mimeType)) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "MEDIA_TYPE_NOT_ALLOWED",
        "The requested media type is not allowed.",
        [{ field: "mimeType", code: "MEDIA_TYPE_NOT_ALLOWED" }],
      );
    }
    if (dto.byteSize > MAX_UPLOAD_BYTES) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "MEDIA_TOO_LARGE",
        "The media file exceeds the maximum allowed size.",
        [{ field: "byteSize", code: "MEDIA_TOO_LARGE" }],
      );
    }
  }

  private async createSignedAsset(
    tenant: TenantContext,
    dto: PresignOrderMediaDto,
    repairOrderId: string | null,
  ): Promise<PresignMediaResponse> {
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    const folder = repairOrderId
      ? `orders/${repairOrderId}/${dto.purpose.toLowerCase()}`
      : "intake";
    const objectKey = `shops/${tenant.shopId}/${folder}/${randomUUID()}.${EXTENSION_BY_MIME[dto.mimeType]}`;
    const data = {
      purpose: dto.purpose,
      objectKey,
      originalName: dto.originalName,
      mimeType: dto.mimeType,
      byteSize: dto.byteSize,
      checksumSha256: dto.checksumSha256?.toLowerCase() ?? null,
      uploadedByUserId: tenant.userId,
      expiresAt,
    };
    const asset = repairOrderId
      ? await this.repository.createOrderProvisional(tenant, repairOrderId, data)
      : await this.repository.createProvisional(tenant, data);

    try {
      const uploadUrl = await this.storage.presignPut({
        objectKey,
        mimeType: dto.mimeType,
        byteSize: dto.byteSize,
        checksumSha256: asset.checksumSha256,
        expiresAt,
      });
      return { data: { mediaAssetId: asset.id, uploadUrl, expiresAt: expiresAt.toISOString() } };
    } catch {
      if (repairOrderId) {
        await this.repository.deleteOrderProvisional(tenant, repairOrderId, asset.id);
      } else {
        await this.repository.deleteProvisional(tenant, asset.id);
      }
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "STORAGE_UNAVAILABLE",
        "The upload service is temporarily unavailable.",
      );
    }
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
