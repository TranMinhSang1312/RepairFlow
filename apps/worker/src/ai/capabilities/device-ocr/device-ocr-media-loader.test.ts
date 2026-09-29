import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  DeviceOcrMediaError,
  DeviceOcrMediaLoader,
  type PrivateObjectReader,
} from "./device-ocr-media-loader.js";

const NOW = new Date("2026-09-29T00:00:00.000Z");
const shopId = "11111111-1111-4111-8111-111111111111";
const mediaAssetId = "22222222-2222-4222-8222-222222222222";

describe("DeviceOcrMediaLoader", () => {
  it("rechecks the server-owned asset, strips metadata and clears the source buffer", async () => {
    const bytes = jpegWithExif();
    const reader: PrivateObjectReader = {
      read: vi.fn().mockResolvedValue({ bytes, byteSize: bytes.length, mimeType: "image/jpeg" }),
    };
    const loader = new DeviceOcrMediaLoader(prismaWith(asset(bytes.length)), reader, 10_000);
    const loaded = await loader.load({ shopId, mediaAssetId, repairOrderId: null, now: NOW });
    expect(reader.read).toHaveBeenCalledWith("private/object-key-never-forwarded", 10_000);
    expect(Buffer.from(loaded.image.base64Data, "base64").toString("latin1")).not.toContain("GPS");
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    loaded.dispose();
    expect(loaded.image.base64Data).toBe("");
  });

  it("fails authorization before object I/O for expired, cross-tenant or rebound media", async () => {
    const reader = { read: vi.fn() } satisfies PrivateObjectReader;
    const expired = asset(10, { expiresAt: new Date(NOW.getTime() - 1) });
    await expect(
      new DeviceOcrMediaLoader(prismaWith(expired), reader, 10_000).load({
        shopId,
        mediaAssetId,
        repairOrderId: null,
        now: NOW,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "AI_AUTHORIZATION_REVOKED" }));
    await expect(
      new DeviceOcrMediaLoader(prismaWith(null), reader, 10_000).load({
        shopId,
        mediaAssetId,
        repairOrderId: null,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DeviceOcrMediaError);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("classifies missing or mismatched private objects without exposing their key", async () => {
    const reader: PrivateObjectReader = {
      read: vi.fn().mockRejectedValue(new Error("NoSuchKey private/object-key-never-forwarded")),
    };
    const loader = new DeviceOcrMediaLoader(prismaWith(asset(10)), reader, 10_000);
    await expect(
      loader.load({ shopId, mediaAssetId, repairOrderId: null, now: NOW }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "AI_MEDIA_UNAVAILABLE", message: "AI_MEDIA_UNAVAILABLE" }),
    );
  });
});

function asset(byteSize: number, override: Record<string, unknown> = {}) {
  return {
    id: mediaAssetId,
    shopId,
    repairOrderId: null,
    purpose: "INTAKE",
    objectKey: "private/object-key-never-forwarded",
    originalName: "device.jpg",
    mimeType: "image/jpeg",
    byteSize,
    checksumSha256: null,
    uploadedByUserId: "33333333-3333-4333-8333-333333333333",
    uploadedAt: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
    createdAt: NOW,
    ...override,
  };
}

function prismaWith(value: unknown): PrismaClient {
  return {
    mediaAsset: { findFirst: vi.fn().mockResolvedValue(value) },
  } as unknown as PrismaClient;
}

function jpegWithExif(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x05, 0x47, 0x50, 0x53, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff,
    0xd9,
  ]);
}
