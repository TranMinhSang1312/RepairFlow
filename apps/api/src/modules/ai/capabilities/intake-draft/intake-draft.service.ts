/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest uses constructor tokens at runtime. */

import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AiCapability, MediaPurpose, MembershipRole, type MediaAsset } from "@prisma/client";
import {
  INTAKE_DRAFT_PROMPT_VERSION,
  INTAKE_DRAFT_SCHEMA_VERSION,
  normalizePlainText,
} from "@repairflow/contracts";
import { redactAiInput } from "@repairflow/security";

import { ApiException } from "../../../../common/api-exception.js";
import type { TenantContext } from "../../../../common/tenant/tenant-context.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../../../../infra/object-storage/object-storage.port.js";
import { AiEnqueueService } from "../../ai-enqueue.service.js";
import {
  AI_INTAKE_AUDIO_ENABLED,
  AI_MAX_AUDIO_BYTES,
  AI_TRANSCRIPTION_PROVIDER,
} from "../../ai.tokens.js";
import type { CreateIntakeDraftDto } from "./intake-draft.dto.js";
import { IntakeDraftRepository } from "./intake-draft.repository.js";

const INTAKE_DRAFT_UPPER_BOUND_MICROUSD = 5_000n;
const MAX_INPUT_BYTES = 16_000;
const AUDIO_MIME_TYPES = new Set(["audio/wav", "audio/x-wav"]);
const PROHIBITED_INPUT =
  /(?:password|passcode|recovery\s*key|bearer\s+[a-z0-9._~+/=-]+|api[_ -]?key|mật\s*khẩu|mã\s*pin|pin\s*[:=]|token\s*[:=])/iu;
const PROMPT_INJECTION =
  /(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?|system\s+prompt|developer\s+message)/iu;

@Injectable()
export class IntakeDraftService {
  constructor(
    private readonly repository: IntakeDraftRepository,
    private readonly enqueueService: AiEnqueueService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AI_INTAKE_AUDIO_ENABLED) private readonly audioEnabled: boolean,
    @Inject(AI_TRANSCRIPTION_PROVIDER) private readonly transcriptionProvider: "disabled" | "fake",
    @Inject(AI_MAX_AUDIO_BYTES) private readonly maxAudioBytes: number,
  ) {}

  async create(
    tenant: TenantContext,
    dto: CreateIntakeDraftDto,
    idempotencyKey: string | undefined,
  ) {
    if (tenant.role === MembershipRole.TECHNICIAN) throw this.notFound();
    const prepared = await this.prepareSource(tenant, dto);

    return this.enqueueService.enqueue({
      tenant,
      capability: AiCapability.INTAKE_DRAFT,
      promptVersion: INTAKE_DRAFT_PROMPT_VERSION,
      schemaVersion: INTAKE_DRAFT_SCHEMA_VERSION,
      inputReference: prepared.idempotencyReference,
      buildInputReference: async (transaction) => {
        if (prepared.mediaAssetId) {
          const current = await this.repository.findMedia(
            tenant.shopId,
            prepared.mediaAssetId,
            transaction,
          );
          if (!current) throw this.notFound();
          if (prepared.sourceType === "AUDIO") this.assertAudioEligible(current);
          else if (current.purpose !== MediaPurpose.AI_INTAKE_AUDIO) throw this.notFound();
        }
        return prepared.storedReference;
      },
      serverOwnedInputReference: true,
      upperBoundCostMicrousd: INTAKE_DRAFT_UPPER_BOUND_MICROUSD,
      idempotencyKey,
    });
  }

  private async prepareSource(tenant: TenantContext, dto: CreateIntakeDraftDto) {
    const base = { deviceType: dto.deviceType, language: dto.language } as const;
    if (dto.source.type === "TEXT" || dto.source.type === "TRANSCRIPT") {
      if (
        !dto.source.text ||
        dto.source.mediaAssetId ||
        dto.source.consentAcknowledged !== undefined
      ) {
        throw this.validation("source", "VALIDATION_FAILED");
      }
      if (dto.source.type === "TEXT" && dto.source.sourceMediaAssetId) {
        throw this.validation("source.sourceMediaAssetId", "VALIDATION_FAILED");
      }
      const normalized = normalizePlainText(dto.source.text);
      if (
        !normalized ||
        Buffer.byteLength(normalized, "utf8") > MAX_INPUT_BYTES ||
        PROHIBITED_INPUT.test(normalized) ||
        PROMPT_INJECTION.test(normalized)
      ) {
        throw this.prohibitedInput();
      }
      const redacted = redactAiInput({ transcript: normalized });
      const transcript =
        isRecord(redacted.value) && typeof redacted.value.transcript === "string"
          ? normalizePlainText(redacted.value.transcript)
          : "";
      if (!transcript || transcript.replaceAll("[REDACTED]", "").trim().length < 3) {
        throw this.prohibitedInput();
      }
      const sourceMediaAssetId = dto.source.sourceMediaAssetId?.toLowerCase();
      if (sourceMediaAssetId) {
        const media = await this.repository.findMedia(tenant.shopId, sourceMediaAssetId);
        if (!media || media.purpose !== MediaPurpose.AI_INTAKE_AUDIO) throw this.notFound();
      }
      return {
        sourceType: dto.source.type,
        mediaAssetId: sourceMediaAssetId,
        idempotencyReference: {
          sourceType: dto.source.type,
          transcript: normalized,
          ...(sourceMediaAssetId ? { sourceMediaAssetId } : {}),
          ...base,
        },
        storedReference: {
          sourceType: dto.source.type,
          transcript,
          ...(sourceMediaAssetId ? { sourceMediaAssetId } : {}),
          ...base,
        },
      };
    }

    if (
      dto.source.type !== "AUDIO" ||
      !dto.source.mediaAssetId ||
      dto.source.text ||
      dto.source.sourceMediaAssetId ||
      dto.source.consentAcknowledged !== true
    ) {
      throw this.validation("source", "VALIDATION_FAILED");
    }
    if (!this.audioEnabled) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "AI_FEATURE_DISABLED",
        "AI intake audio is disabled.",
      );
    }
    if (this.transcriptionProvider === "disabled") throw this.transcriptionUnavailable();
    const mediaAssetId = dto.source.mediaAssetId.toLowerCase();
    const media = await this.repository.findMedia(tenant.shopId, mediaAssetId);
    if (!media) throw this.notFound();
    this.assertAudioEligible(media);
    await this.assertStoredObject(media);
    return {
      sourceType: "AUDIO" as const,
      mediaAssetId,
      idempotencyReference: {
        sourceType: "AUDIO",
        mediaAssetId,
        consentAcknowledged: true,
        ...base,
      },
      storedReference: {
        sourceType: "AUDIO",
        mediaAssetId,
        consentAcknowledged: true,
        media: { mimeType: media.mimeType, byteSize: media.byteSize },
        ...base,
      },
    };
  }

  private assertAudioEligible(media: MediaAsset): void {
    const now = new Date();
    if (
      media.purpose !== MediaPurpose.AI_INTAKE_AUDIO ||
      media.repairOrderId !== null ||
      !AUDIO_MIME_TYPES.has(media.mimeType) ||
      media.byteSize < 1 ||
      media.byteSize > this.maxAudioBytes ||
      media.uploadedAt !== null ||
      media.expiresAt === null ||
      media.expiresAt <= now
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "MEDIA_UPLOAD_INCOMPLETE",
        "The selected intake audio is incomplete or expired.",
      );
    }
  }

  private async assertStoredObject(media: MediaAsset): Promise<void> {
    let stored;
    try {
      stored = await this.storage.head(media.objectKey);
    } catch {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "STORAGE_UNAVAILABLE",
        "Private object storage is temporarily unavailable.",
      );
    }
    if (
      !stored ||
      stored.byteSize !== media.byteSize ||
      stored.mimeType !== media.mimeType ||
      (media.checksumSha256 && stored.checksumSha256 !== media.checksumSha256)
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "MEDIA_UPLOAD_INCOMPLETE",
        "The selected intake audio is incomplete or expired.",
      );
    }
  }

  private validation(field: string, code: string): ApiException {
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, "Invalid intake draft source.", [
      { field, code },
    ]);
  }

  private prohibitedInput(): ApiException {
    return new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "AI_INPUT_PROHIBITED",
      "Remove credentials, tokens or unsupported personal data before using AI assistance.",
    );
  }

  private transcriptionUnavailable(): ApiException {
    return new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      "AI_TRANSCRIPTION_UNAVAILABLE",
      "Audio transcription is unavailable.",
    );
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
