import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { PrivateObjectReader } from "../device-ocr/device-ocr-media-loader.js";
import { IntakeAudioMediaLoader, wavDurationSeconds } from "./intake-audio-media-loader.js";

const NOW = new Date("2026-09-29T12:00:00.000Z");

describe("IntakeAudioMediaLoader", () => {
  it("validates WAV duration and disposes private bytes", async () => {
    const bytes = wav(1);
    const prisma = prismaWith(asset(bytes));
    const objects = reader(bytes);
    const loaded = await new IntakeAudioMediaLoader(prisma, objects, 1_000_000, 300).load({
      shopId: "shop-a",
      mediaAssetId: "media-a",
      now: NOW,
    });
    expect(loaded.durationSeconds).toBeCloseTo(1, 4);
    expect(loaded.audio.bytes.some((byte) => byte !== 0)).toBe(true);
    loaded.dispose();
    expect(loaded.audio.bytes.every((byte) => byte === 0)).toBe(true);
    await loaded.cleanup();
    expect(objects.delete).toHaveBeenCalledWith("private/audio.wav");
  });

  it("rejects expired, over-duration and malformed media", async () => {
    const bytes = wav(2);
    await expect(
      new IntakeAudioMediaLoader(
        prismaWith(asset(bytes, { expiresAt: new Date(0) })),
        reader(bytes),
        1_000_000,
        300,
      ).load({
        shopId: "shop-a",
        mediaAssetId: "media-a",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "AI_AUTHORIZATION_REVOKED" });
    await expect(
      new IntakeAudioMediaLoader(prismaWith(asset(bytes)), reader(bytes), 1_000_000, 1).load({
        shopId: "shop-a",
        mediaAssetId: "media-a",
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "AI_MEDIA_UNAVAILABLE" });
    expect(wavDurationSeconds(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

function asset(bytes: Uint8Array, changes: Record<string, unknown> = {}) {
  return {
    id: "media-a",
    shopId: "shop-a",
    repairOrderId: null,
    purpose: "AI_INTAKE_AUDIO",
    objectKey: "private/audio.wav",
    originalName: "audio.wav",
    mimeType: "audio/wav",
    byteSize: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    uploadedByUserId: "user-a",
    uploadedAt: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
    createdAt: NOW,
    ...changes,
  };
}

function prismaWith(media: ReturnType<typeof asset>): PrismaClient {
  return {
    mediaAsset: {
      findFirst: vi.fn().mockResolvedValue(media),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaClient;
}

function reader(source: Uint8Array): PrivateObjectReader {
  return {
    read: vi.fn().mockImplementation(() => {
      const bytes = source.slice();
      return Promise.resolve({ bytes, byteSize: bytes.byteLength, mimeType: "audio/wav" });
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function wav(seconds: number): Uint8Array {
  const sampleRate = 8000;
  const byteRate = sampleRate * 2;
  const dataSize = byteRate * seconds;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataSize, true);
  bytes.fill(7, 44);
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1)
    bytes[offset + index] = value.charCodeAt(index);
}
