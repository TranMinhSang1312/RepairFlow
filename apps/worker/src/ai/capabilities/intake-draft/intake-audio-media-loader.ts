import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

import type { PrivateObjectReader } from "../device-ocr/device-ocr-media-loader.js";

const AUDIO_MIME_TYPES = new Set(["audio/wav", "audio/x-wav"] as const);

export class IntakeAudioMediaError extends Error {
  constructor(readonly code: "AI_AUTHORIZATION_REVOKED" | "AI_MEDIA_UNAVAILABLE") {
    super(code);
    this.name = "IntakeAudioMediaError";
  }
}

export interface LoadedIntakeAudio {
  audio: { mediaType: "audio/wav" | "audio/x-wav"; bytes: Uint8Array };
  durationSeconds: number;
  dispose(): void;
  cleanup(): Promise<void>;
}

export class IntakeAudioMediaLoader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly objects: PrivateObjectReader,
    private readonly maxBytes: number,
    private readonly maxDurationSeconds: number,
  ) {}

  async load(input: {
    shopId: string;
    mediaAssetId: string;
    now: Date;
  }): Promise<LoadedIntakeAudio> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: input.mediaAssetId, shopId: input.shopId },
    });
    if (
      !asset ||
      asset.purpose !== "AI_INTAKE_AUDIO" ||
      asset.repairOrderId !== null ||
      !AUDIO_MIME_TYPES.has(asset.mimeType as "audio/wav" | "audio/x-wav") ||
      asset.byteSize < 1 ||
      asset.byteSize > this.maxBytes ||
      asset.uploadedAt !== null ||
      asset.expiresAt === null ||
      asset.expiresAt <= input.now
    ) {
      throw new IntakeAudioMediaError("AI_AUTHORIZATION_REVOKED");
    }
    let stored;
    try {
      stored = await this.objects.read(asset.objectKey, this.maxBytes);
    } catch {
      throw new IntakeAudioMediaError("AI_MEDIA_UNAVAILABLE");
    }
    if (
      stored.byteSize !== asset.byteSize ||
      stored.bytes.byteLength !== asset.byteSize ||
      stored.mimeType !== asset.mimeType ||
      (asset.checksumSha256 &&
        createHash("sha256").update(stored.bytes).digest("hex") !== asset.checksumSha256)
    ) {
      stored.bytes.fill(0);
      throw new IntakeAudioMediaError("AI_MEDIA_UNAVAILABLE");
    }
    const durationSeconds = wavDurationSeconds(stored.bytes);
    if (
      durationSeconds === null ||
      durationSeconds <= 0 ||
      durationSeconds > this.maxDurationSeconds
    ) {
      stored.bytes.fill(0);
      throw new IntakeAudioMediaError("AI_MEDIA_UNAVAILABLE");
    }
    const audio = {
      mediaType: asset.mimeType as "audio/wav" | "audio/x-wav",
      bytes: stored.bytes,
    };
    return {
      audio,
      durationSeconds,
      dispose: () => audio.bytes.fill(0),
      cleanup: async () => {
        audio.bytes.fill(0);
        if (!this.objects.delete) throw new IntakeAudioMediaError("AI_MEDIA_UNAVAILABLE");
        try {
          await this.objects.delete(asset.objectKey);
          await this.prisma.mediaAsset.deleteMany({
            where: {
              id: asset.id,
              shopId: asset.shopId,
              repairOrderId: null,
              purpose: "AI_INTAKE_AUDIO",
            },
          });
        } catch {
          throw new IntakeAudioMediaError("AI_MEDIA_UNAVAILABLE");
        }
      },
    };
  }
}

export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.byteLength) return null;
    if (id === "fmt " && size >= 16) byteRate = view.getUint32(body + 8, true);
    if (id === "data") dataBytes = size;
    offset = body + size + (size % 2);
  }
  if (byteRate <= 0 || dataBytes <= 0) return null;
  return dataBytes / byteRate;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
