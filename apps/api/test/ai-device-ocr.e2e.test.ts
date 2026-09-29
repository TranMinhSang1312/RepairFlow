import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AiCapability, DeviceType, MembershipRole, MembershipStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { TokenService } from "../src/common/auth/token.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../src/infra/object-storage/object-storage.port.js";
import { AI_GLOBAL_ENABLED, AI_MAX_IMAGE_BYTES } from "../src/modules/ai/ai.tokens.js";

interface Actor {
  userId: string;
  token: string;
}

describe("RF-062 device OCR enqueue", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let shopAId: string;
  let shopBId: string;
  let orderId: string;
  let owner: Actor;
  let receptionist: Actor;
  let assignedTechnician: Actor;
  let unassignedTechnician: Actor;
  let ownerB: Actor;
  let userIds: string[];
  const stored = new Map<
    string,
    { byteSize: number; mimeType: string; checksumSha256: string | null }
  >();
  const head = vi.fn(async (objectKey: string) => stored.get(objectKey) ?? null);
  const storage: ObjectStoragePort = {
    presignPut: async () => "https://storage.test/upload",
    head,
    delete: async () => undefined,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_GLOBAL_ENABLED)
      .useValue(true)
      .overrideProvider(AI_MAX_IMAGE_BYTES)
      .useValue(10_000_000)
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);
    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `RF062 A ${suffix}`, slug: `rf062-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `RF062 B ${suffix}`, slug: `rf062-b-${suffix}` } }),
    ]);
    shopAId = shopA.id;
    shopBId = shopB.id;
    const branch = await prisma.branch.create({ data: { shopId: shopAId, name: "Main" } });
    const customer = await prisma.customer.create({
      data: {
        shopId: shopAId,
        name: "OCR Customer",
        phoneRaw: "0901000000",
        phoneNormalized: "+84901000000",
      },
    });
    const device = await prisma.device.create({
      data: {
        shopId: shopAId,
        customerId: customer.id,
        type: DeviceType.PHONE,
        brand: "A",
        model: "B",
      },
    });
    const roleSpecs = [
      [MembershipRole.OWNER, shopAId],
      [MembershipRole.RECEPTIONIST, shopAId],
      [MembershipRole.TECHNICIAN, shopAId],
      [MembershipRole.TECHNICIAN, shopAId],
      [MembershipRole.OWNER, shopBId],
    ] as const;
    const users = await Promise.all(
      roleSpecs.map((_, index) =>
        prisma.user.create({
          data: {
            email: `rf062-${index}-${suffix}@example.test`,
            passwordHash: "test-only",
            displayName: `RF062 ${index}`,
          },
        }),
      ),
    );
    userIds = users.map((user) => user.id);
    await prisma.shopMembership.createMany({
      data: roleSpecs.map(([role, shopId], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status: MembershipStatus.ACTIVE,
      })),
    });
    const actor = (index: number): Actor => ({
      userId: users[index]!.id,
      token: tokens.createAccessToken(users[index]!.id).token,
    });
    owner = actor(0);
    receptionist = actor(1);
    assignedTechnician = actor(2);
    unassignedTechnician = actor(3);
    ownerB = actor(4);
    const order = await prisma.repairOrder.create({
      data: {
        shopId: shopAId,
        branchId: branch.id,
        customerId: customer.id,
        deviceId: device.id,
        orderNo: 62,
        code: `RF062-${suffix}`,
        reportedProblem: "OCR",
        intakeCondition: "Used",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "OCR" },
        deviceSnapshot: { type: "PHONE", brand: "A", model: "B" },
        createdByUserId: owner.userId,
      },
    });
    orderId = order.id;
    await prisma.assignment.create({
      data: {
        shopId: shopAId,
        repairOrderId: orderId,
        technicianUserId: assignedTechnician.userId,
        assignedByUserId: owner.userId,
      },
    });
    await prisma.aiCapabilitySetting.create({
      data: {
        shopId: shopAId,
        capability: AiCapability.DEVICE_OCR,
        enabled: true,
        monthlyBudgetMicrousd: 100_000n,
        maxRunCostMicrousd: 10_000n,
        updatedByUserId: owner.userId,
      },
    });
  });

  afterAll(async () => {
    const shops = [shopAId, shopBId];
    await prisma.outboxEvent.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.aiRun.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.aiUsagePeriod.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.aiCapabilitySetting.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.mediaAsset.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.assignment.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.shop.deleteMany({ where: { id: { in: shops } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  async function media(
    input: {
      shopId?: string;
      repairOrderId?: string | null;
      expiresAt?: Date | null;
      uploadedAt?: Date | null;
      mimeType?: string;
      byteSize?: number;
      stored?: boolean;
    } = {},
  ) {
    const objectKey = `tests/rf062/${randomUUID()}`;
    const asset = await prisma.mediaAsset.create({
      data: {
        shopId: input.shopId ?? shopAId,
        repairOrderId: input.repairOrderId ?? null,
        purpose: "INTAKE",
        objectKey,
        originalName: "device.jpg",
        mimeType: input.mimeType ?? "image/jpeg",
        byteSize: input.byteSize ?? 128,
        uploadedByUserId: owner.userId,
        uploadedAt: input.uploadedAt === undefined ? null : input.uploadedAt,
        expiresAt: input.expiresAt === undefined ? new Date(Date.now() + 60_000) : input.expiresAt,
      },
    });
    if (input.stored !== false) {
      stored.set(objectKey, {
        byteSize: asset.byteSize,
        mimeType: asset.mimeType,
        checksumSha256: null,
      });
    }
    return asset;
  }

  function enqueue(actor: Actor, mediaAssetId: string, key = randomUUID(), shopId = shopAId) {
    return request(app.getHttpServer())
      .post("/api/v1/ai/device-ocr")
      .set("Authorization", `Bearer ${actor.token}`)
      .set("X-Shop-Id", shopId)
      .set("Idempotency-Key", key)
      .send({ mediaAssetId, allowedFields: ["brand", "model", "imei"] });
  }

  it.each(["owner", "receptionist"])(
    "queues a minimal provisional-media reference for %s",
    async (role) => {
      const asset = await media();
      const response = await enqueue(role === "owner" ? owner : receptionist, asset.id).expect(202);
      expect(response.body.data).toMatchObject({
        capability: "DEVICE_OCR",
        promptVersion: "device-ocr-v1",
        schemaVersion: "1",
        status: "QUEUED",
      });
      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: response.body.data.id } });
      expect(run.inputReference).toEqual({
        mediaAssetId: asset.id,
        allowedFields: ["brand", "imei", "model"],
        media: { mimeType: "image/jpeg", byteSize: 128 },
      });
      expect(JSON.stringify(run.inputReference)).not.toContain(asset.objectKey);
    },
  );

  it("allows only an actively assigned technician for attached media", async () => {
    const asset = await media({ repairOrderId: orderId, uploadedAt: new Date(), expiresAt: null });
    await enqueue(assignedTechnician, asset.id).expect(202);
    head.mockClear();
    const denied = await enqueue(unassignedTechnician, asset.id).expect(404);
    expect(denied.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(head).not.toHaveBeenCalled();
    const provisional = await media();
    await enqueue(assignedTechnician, provisional.id).expect(404);
  });

  it("hides cross-tenant media and rejects incomplete or missing objects", async () => {
    const crossTenant = await media({ shopId: shopBId });
    await enqueue(owner, crossTenant.id).expect(404);
    await enqueue(ownerB, crossTenant.id, randomUUID(), shopBId).expect(409);

    const expired = await media({ expiresAt: new Date(Date.now() - 1000) });
    expect((await enqueue(owner, expired.id).expect(409)).body.error.code).toBe(
      "MEDIA_UPLOAD_INCOMPLETE",
    );
    const missing = await media({ stored: false });
    expect((await enqueue(owner, missing.id).expect(409)).body.error.code).toBe(
      "MEDIA_UPLOAD_INCOMPLETE",
    );
  });

  it("rejects invalid type, size and allowed fields before creating a run", async () => {
    const invalidType = await media({ mimeType: "application/pdf" });
    expect((await enqueue(owner, invalidType.id).expect(422)).body.error.code).toBe(
      "MEDIA_TYPE_NOT_ALLOWED",
    );
    const tooLarge = await media({ byteSize: 10_000_001 });
    expect((await enqueue(owner, tooLarge.id).expect(422)).body.error.code).toBe("MEDIA_TOO_LARGE");
    const valid = await media();
    await request(app.getHttpServer())
      .post("/api/v1/ai/device-ocr")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", shopAId)
      .set("Idempotency-Key", randomUUID())
      .send({ mediaAssetId: valid.id, allowedFields: ["password"] })
      .expect(422);
  });

  it("replays the same key and rejects a changed allowlist", async () => {
    const asset = await media();
    const key = randomUUID();
    const first = await enqueue(owner, asset.id, key).expect(202);
    const replay = await enqueue(owner, asset.id, key).expect(202);
    expect(replay.body.data.id).toBe(first.body.data.id);
    const mismatch = await request(app.getHttpServer())
      .post("/api/v1/ai/device-ocr")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", shopAId)
      .set("Idempotency-Key", key)
      .send({ mediaAssetId: asset.id, allowedFields: ["serialNumber"] })
      .expect(409);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("exposes only effective availability to staff and records an OCR review once", async () => {
    const availability = await request(app.getHttpServer())
      .get("/api/v1/ai/capabilities")
      .set("Authorization", `Bearer ${receptionist.token}`)
      .set("X-Shop-Id", shopAId)
      .expect(200);
    expect(availability.body.data).toContainEqual({
      capability: "DEVICE_OCR",
      effectiveEnabled: true,
    });
    expect(JSON.stringify(availability.body)).not.toContain("monthlyBudgetMicrousd");

    const asset = await media();
    const queued = await enqueue(owner, asset.id).expect(202);
    const originalOutput = {
      brand: { value: "Apple", confidence: 0.9 },
      model: { value: "iPhone 16", confidence: 0.8 },
      serialNumber: { value: null, confidence: 0 },
      imei: { value: null, confidence: 0 },
      warnings: [],
    };
    await prisma.aiRun.update({
      where: { id: queued.body.data.id },
      data: { status: "SUCCEEDED", output: originalOutput, completedAt: new Date() },
    });
    const reviewedOutput = {
      ...originalOutput,
      model: { value: null, confidence: 0 },
    };
    await request(app.getHttpServer())
      .post(`/api/v1/ai/runs/${queued.body.data.id as string}/review`)
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", shopAId)
      .send({ outcome: "ACCEPTED_EDITED", reviewedOutput })
      .expect(200);
    const reuse = await request(app.getHttpServer())
      .post(`/api/v1/ai/runs/${queued.body.data.id as string}/review`)
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", shopAId)
      .send({ outcome: "REJECTED" })
      .expect(409);
    expect(reuse.body.error.code).toBe("AI_DRAFT_ALREADY_APPLIED");
  });
});
