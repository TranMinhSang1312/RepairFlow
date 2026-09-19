import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MediaPurpose, MembershipRole, MembershipStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { TokenService } from "../src/common/auth/token.service.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
  type PresignPutInput,
  type StoredObjectMetadata,
} from "../src/infra/object-storage/object-storage.port.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";
import { MediaUploadVerifier } from "../src/modules/media/media-upload-verifier.service.js";

class FakeObjectStorage implements ObjectStoragePort {
  readonly presignInputs: PresignPutInput[] = [];
  readonly objects = new Map<string, StoredObjectMetadata>();
  failNextPresign = false;

  async presignPut(input: PresignPutInput): Promise<string> {
    this.presignInputs.push(input);
    if (this.failNextPresign) {
      this.failNextPresign = false;
      throw new Error("storage unavailable");
    }
    return `https://storage.test/upload/${encodeURIComponent(input.objectKey)}?signature=test-secret`;
  }

  async head(objectKey: string): Promise<StoredObjectMetadata | null> {
    return this.objects.get(objectKey) ?? null;
  }

  async delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
}

interface Fixture {
  shopAId: string;
  shopBId: string;
  ownerToken: string;
  receptionistToken: string;
  technicianToken: string;
  userIds: string[];
}

describe("intake media API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifier: MediaUploadVerifier;
  let fixture: Fixture;
  const storage = new FakeObjectStorage();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    verifier = app.get(MediaUploadVerifier);
    const tokenService = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);
    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `Media A ${suffix}`, slug: `media-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `Media B ${suffix}`, slug: `media-b-${suffix}` } }),
    ]);
    const roles = [MembershipRole.OWNER, MembershipRole.RECEPTIONIST, MembershipRole.TECHNICIAN];
    const users = await Promise.all(
      roles.map((role) =>
        prisma.user.create({
          data: {
            email: `media-${role.toLowerCase()}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName: `Media ${role}`,
          },
        }),
      ),
    );
    await prisma.shopMembership.createMany({
      data: roles.map((role, index) => ({
        shopId: shopA.id,
        userId: users[index]!.id,
        role,
        status: MembershipStatus.ACTIVE,
      })),
    });
    fixture = {
      shopAId: shopA.id,
      shopBId: shopB.id,
      ownerToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.mediaAsset.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await app.close();
  });

  function presign(token = fixture.ownerToken, shopId = fixture.shopAId) {
    return request(app.getHttpServer())
      .post("/api/v1/media/presign")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", shopId);
  }

  const validPayload = {
    purpose: MediaPurpose.INTAKE,
    originalName: "device-front.jpg",
    mimeType: "image/jpeg",
    byteSize: 1_024_000,
    checksumSha256: "A".repeat(64),
  };

  it("creates a private provisional asset and returns a short-lived signed URL", async () => {
    const response = await presign(fixture.receptionistToken).send(validPayload).expect(201);

    expect(response.body.data).toMatchObject({
      mediaAssetId: expect.any(String),
      uploadUrl: expect.stringMatching(/^https:\/\/storage\.test\/upload\//),
      expiresAt: expect.any(String),
    });
    const asset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: response.body.data.mediaAssetId },
    });
    expect(asset).toMatchObject({
      shopId: fixture.shopAId,
      repairOrderId: null,
      purpose: MediaPurpose.INTAKE,
      originalName: validPayload.originalName,
      mimeType: validPayload.mimeType,
      byteSize: validPayload.byteSize,
      checksumSha256: validPayload.checksumSha256.toLowerCase(),
      uploadedAt: null,
    });
    expect(asset.objectKey).toMatch(
      new RegExp(`^shops/${fixture.shopAId}/intake/[0-9a-f-]+\\.jpg$`),
    );
    expect(asset.objectKey).not.toContain(validPayload.originalName);
    expect(asset.expiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(asset.expiresAt?.getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);
    expect(storage.presignInputs.at(-1)).toMatchObject({
      objectKey: asset.objectKey,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      checksumSha256: asset.checksumSha256,
    });
  });

  it("creates unique object keys without incorporating unsafe filenames", async () => {
    const first = await presign()
      .send({ ...validPayload, originalName: "../../first image.png", mimeType: "image/png" })
      .expect(201);
    const second = await presign()
      .send({ ...validPayload, originalName: "../../first image.png", mimeType: "image/png" })
      .expect(201);
    const assets = await prisma.mediaAsset.findMany({
      where: { id: { in: [first.body.data.mediaAssetId, second.body.data.mediaAssetId] } },
    });

    expect(assets).toHaveLength(2);
    expect(assets[0]!.objectKey).not.toBe(assets[1]!.objectKey);
    expect(assets.every((asset) => !asset.objectKey.includes(".."))).toBe(true);
  });

  it("denies technicians and users outside the selected shop", async () => {
    const denied = await presign(fixture.technicianToken).send(validPayload).expect(403);
    const wrongShop = await presign(fixture.ownerToken, fixture.shopBId)
      .send(validPayload)
      .expect(404);

    expect(denied.body.error.code).toBe("PERMISSION_DENIED");
    expect(wrongShop.body.error.code).toBe("SHOP_NOT_FOUND");
  });

  it("rejects unsupported purpose, type, size, filename and checksum", async () => {
    const wrongPurpose = await presign()
      .send({ ...validPayload, purpose: MediaPurpose.DIAGNOSIS })
      .expect(422);
    const wrongType = await presign()
      .send({ ...validPayload, mimeType: "application/pdf" })
      .expect(422);
    const tooLarge = await presign()
      .send({ ...validPayload, byteSize: 15_000_001 })
      .expect(422);
    const emptyName = await presign()
      .send({ ...validPayload, originalName: "" })
      .expect(422);
    const badChecksum = await presign()
      .send({ ...validPayload, checksumSha256: "not-a-checksum" })
      .expect(422);

    expect(wrongPurpose.body.error.code).toBe("VALIDATION_FAILED");
    expect(wrongType.body.error.code).toBe("MEDIA_TYPE_NOT_ALLOWED");
    expect(tooLarge.body.error.code).toBe("MEDIA_TOO_LARGE");
    expect(emptyName.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "originalName" })]),
    );
    expect(badChecksum.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "checksumSha256" })]),
    );
  });

  it("removes provisional database metadata when signing fails", async () => {
    const before = await prisma.mediaAsset.count({ where: { shopId: fixture.shopAId } });
    storage.failNextPresign = true;
    const response = await presign().send(validPayload).expect(503);

    expect(response.body.error.code).toBe("STORAGE_UNAVAILABLE");
    expect(await prisma.mediaAsset.count({ where: { shopId: fixture.shopAId } })).toBe(before);
  });

  it("provides deterministic metadata verification for RF-015", async () => {
    const response = await presign().send(validPayload).expect(201);
    const asset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: response.body.data.mediaAssetId },
    });

    expect(await verifier.isComplete(asset)).toBe(false);
    storage.objects.set(asset.objectKey, {
      byteSize: asset.byteSize,
      mimeType: asset.mimeType,
      checksumSha256: asset.checksumSha256,
    });
    expect(await verifier.isComplete(asset)).toBe(true);
    storage.objects.set(asset.objectKey, {
      byteSize: asset.byteSize + 1,
      mimeType: asset.mimeType,
      checksumSha256: asset.checksumSha256,
    });
    expect(await verifier.isComplete(asset)).toBe(false);
    expect(await verifier.isComplete({ ...asset, expiresAt: new Date(Date.now() - 1) })).toBe(
      false,
    );
  });
});
