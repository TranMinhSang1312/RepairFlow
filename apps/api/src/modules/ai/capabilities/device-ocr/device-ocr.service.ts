/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest uses constructor tokens at runtime. */

import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AiCapability, MediaPurpose, MembershipRole, type MediaAsset } from "@prisma/client";
import {
  DEVICE_OCR_FIELDS,
  DEVICE_OCR_PROMPT_VERSION,
  DEVICE_OCR_SCHEMA_VERSION,
  type DeviceOcrField,
} from "@repairflow/contracts";

import { ApiException } from "../../../../common/api-exception.js";
import type { TenantContext } from "../../../../common/tenant/tenant-context.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../../../../infra/object-storage/object-storage.port.js";
import { AiEnqueueService } from "../../ai-enqueue.service.js";
import { AI_MAX_IMAGE_BYTES } from "../../ai.tokens.js";
import type { CreateDeviceOcrDto } from "./device-ocr.dto.js";
import { DeviceOcrRepository } from "./device-ocr.repository.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEVICE_OCR_UPPER_BOUND_MICROUSD = 5_000n;

@Injectable()
export class DeviceOcrService {
  constructor(
    private readonly repository: DeviceOcrRepository,
    private readonly enqueueService: AiEnqueueService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AI_MAX_IMAGE_BYTES) private readonly maxImageBytes: number,
  ) {}

  async create(tenant: TenantContext, dto: CreateDeviceOcrDto, idempotencyKey: string | undefined) {
    const mediaAssetId = dto.mediaAssetId.toLowerCase();
    const allowedFields = this.allowedFields(dto.allowedFields);
    const asset = await this.repository.findMediaForActor(tenant, mediaAssetId);
    if (!asset) throw this.notFound();
    this.assertEligible(asset, tenant);
    await this.assertStoredObject(asset);

    return this.enqueueService.enqueue({
      tenant,
      capability: AiCapability.DEVICE_OCR,
      ...(asset.repairOrderId ? { repairOrderId: asset.repairOrderId } : {}),
      promptVersion: DEVICE_OCR_PROMPT_VERSION,
      schemaVersion: DEVICE_OCR_SCHEMA_VERSION,
      inputReference: { mediaAssetId, allowedFields },
      buildInputReference: async (transaction) => {
        const current = await this.repository.findMedia(tenant.shopId, mediaAssetId, transaction);
        if (!current || current.repairOrderId !== asset.repairOrderId) throw this.notFound();
        this.assertEligible(current, tenant);
        return {
          mediaAssetId,
          allowedFields,
          media: { mimeType: current.mimeType, byteSize: current.byteSize },
        };
      },
      serverOwnedInputReference: true,
      upperBoundCostMicrousd: DEVICE_OCR_UPPER_BOUND_MICROUSD,
      idempotencyKey,
    });
  }

  private allowedFields(fields: DeviceOcrField[] | undefined): DeviceOcrField[] {
    const requested = fields ?? [...DEVICE_OCR_FIELDS];
    return [...requested].sort((left, right) => left.localeCompare(right));
  }

  private assertEligible(asset: MediaAsset, tenant: TenantContext): void {
    if (asset.purpose !== MediaPurpose.INTAKE) throw this.notFound();
    if (asset.repairOrderId === null && tenant.role === MembershipRole.TECHNICIAN) {
      throw this.notFound();
    }
    if (!ALLOWED_MIME_TYPES.has(asset.mimeType)) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "MEDIA_TYPE_NOT_ALLOWED",
        "The selected media type cannot be used for device OCR.",
      );
    }
    if (asset.byteSize < 1 || asset.byteSize > this.maxImageBytes) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "MEDIA_TOO_LARGE",
        "The selected image exceeds the device OCR limit.",
      );
    }
    const now = new Date();
    const provisionalComplete =
      asset.repairOrderId === null &&
      asset.uploadedAt === null &&
      asset.expiresAt !== null &&
      asset.expiresAt > now;
    const attachedComplete =
      asset.repairOrderId !== null && asset.uploadedAt !== null && asset.expiresAt === null;
    if (!provisionalComplete && !attachedComplete) throw this.incomplete();
  }

  private async assertStoredObject(asset: MediaAsset): Promise<void> {
    let stored;
    try {
      stored = await this.storage.head(asset.objectKey);
    } catch {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "STORAGE_UNAVAILABLE",
        "Private object storage is temporarily unavailable.",
      );
    }
    if (
      !stored ||
      stored.byteSize !== asset.byteSize ||
      stored.mimeType !== asset.mimeType ||
      (asset.checksumSha256 && stored.checksumSha256 !== asset.checksumSha256)
    ) {
      throw this.incomplete();
    }
  }

  private incomplete(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      "MEDIA_UPLOAD_INCOMPLETE",
      "The selected intake image is incomplete or expired.",
    );
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
