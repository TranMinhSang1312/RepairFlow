import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  DeviceType,
  MediaPurpose,
  MembershipRole,
  MembershipStatus,
  RepairOrderStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { TokenService } from "../src/common/auth/token.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
  type PresignPutInput,
  type StoredObjectMetadata,
} from "../src/infra/object-storage/object-storage.port.js";

class FakeObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, StoredObjectMetadata>();

  async presignPut(input: PresignPutInput): Promise<string> {
    return `https://storage.test/${encodeURIComponent(input.objectKey)}`;
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
  branchAId: string;
  branchBId: string;
  customerAId: string;
  customerBId: string;
  otherCustomerAId: string;
  deviceAId: string;
  deviceBId: string;
  otherDeviceAId: string;
  ownerToken: string;
  receptionistToken: string;
  technicianToken: string;
  userIds: string[];
}

describe("repair-order intake API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    const tokenService = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);
    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({
        data: { name: `Orders A ${suffix}`, slug: `orders-a-${suffix}`, orderCodePrefix: "ORD" },
      }),
      prisma.shop.create({
        data: { name: `Orders B ${suffix}`, slug: `orders-b-${suffix}`, orderCodePrefix: "OTH" },
      }),
    ]);
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopA.id, name: "Main A" } }),
      prisma.branch.create({ data: { shopId: shopB.id, name: "Main B" } }),
    ]);
    const [customerA, otherCustomerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "Customer A",
          phoneRaw: "0900000001",
          phoneNormalized: "+84900000001",
          email: "customer-a@example.com",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "Other Customer A",
          phoneRaw: "0900000002",
          phoneNormalized: "+84900000002",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "Customer B",
          phoneRaw: "0900000003",
          phoneNormalized: "+84900000003",
        },
      }),
    ]);
    const [deviceA, otherDeviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopA.id,
          customerId: customerA.id,
          type: DeviceType.PHONE,
          brand: "Apple",
          model: "iPhone Test",
          color: "Black",
          serialNormalized: "SERIALA1234",
          imeiNormalized: "123456789012345",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopA.id,
          customerId: otherCustomerA.id,
          type: DeviceType.LAPTOP,
          brand: "Test",
          model: "Other",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopB.id,
          customerId: customerB.id,
          type: DeviceType.TABLET,
          brand: "Test",
          model: "Cross tenant",
        },
      }),
    ]);
    const roles = [MembershipRole.OWNER, MembershipRole.RECEPTIONIST, MembershipRole.TECHNICIAN];
    const users = await Promise.all(
      roles.map((role) =>
        prisma.user.create({
          data: {
            email: `orders-${role.toLowerCase()}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName: `Order ${role}`,
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
      branchAId: branchA.id,
      branchBId: branchB.id,
      customerAId: customerA.id,
      customerBId: customerB.id,
      otherCustomerAId: otherCustomerA.id,
      deviceAId: deviceA.id,
      deviceBId: deviceB.id,
      otherDeviceAId: otherDeviceA.id,
      ownerToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.intakeAccessory.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.mediaAsset.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await app.close();
  });

  function createRequest(token = fixture.ownerToken) {
    return request(app.getHttpServer())
      .post("/api/v1/repair-orders")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", fixture.shopAId)
      .set("Idempotency-Key", `order-create-${randomUUID()}`);
  }

  async function createMedia(options?: {
    shopId?: string;
    expiresAt?: Date;
    complete?: boolean;
    purpose?: MediaPurpose;
  }): Promise<string> {
    const shopId = options?.shopId ?? fixture.shopAId;
    const objectKey = `shops/${shopId}/intake/${randomUUID()}.jpg`;
    const asset = await prisma.mediaAsset.create({
      data: {
        shopId,
        purpose: options?.purpose ?? MediaPurpose.INTAKE,
        objectKey,
        originalName: "intake.jpg",
        mimeType: "image/jpeg",
        byteSize: 128,
        checksumSha256: "a".repeat(64),
        uploadedByUserId: fixture.userIds[0]!,
        expiresAt: options?.expiresAt ?? new Date(Date.now() + 60_000),
      },
    });
    if (options?.complete !== false) {
      storage.objects.set(objectKey, {
        byteSize: asset.byteSize,
        mimeType: asset.mimeType,
        checksumSha256: asset.checksumSha256,
      });
    }
    return asset.id;
  }

  function validPayload(mediaAssetIds: string[]) {
    return {
      branchId: fixture.branchAId,
      customerId: fixture.customerAId,
      deviceId: fixture.deviceAId,
      reportedProblem: "Device does not power on",
      intakeCondition: "Screen has a light scratch",
      consentAcknowledged: true,
      priority: "HIGH",
      promisedAt: new Date(Date.now() + 86_400_000).toISOString(),
      accessories: [{ name: "Charger", conditionNote: "Used condition" }],
      mediaAssetIds,
    };
  }

  it("creates the complete RECEIVED intake atomically for a receptionist", async () => {
    const mediaAssetId = await createMedia();
    const response = await createRequest(fixture.receptionistToken)
      .set("X-Request-Id", "req-intake-success")
      .send(validPayload([mediaAssetId]))
      .expect(201);

    expect(response.body.data).toMatchObject({
      code: expect.stringMatching(/^ORD-\d{4}-\d{5}$/),
      status: RepairOrderStatus.RECEIVED,
      priority: "HIGH",
      branchId: fixture.branchAId,
      lockVersion: 0,
      assignedTechnicianUserId: null,
      completionOutcome: null,
      customer: { id: fixture.customerAId, name: "Customer A" },
      device: { id: fixture.deviceAId, brand: "Apple", serialMasked: "••••1234" },
    });
    expect(response.body.data).not.toHaveProperty("orderNo");
    expect(response.body.data).not.toHaveProperty("customerSnapshot");

    const order = await prisma.repairOrder.findUniqueOrThrow({
      where: { id: response.body.data.id },
      include: { accessories: true, media: true, events: true },
    });
    expect(order).toMatchObject({
      shopId: fixture.shopAId,
      status: RepairOrderStatus.RECEIVED,
      lockVersion: 0,
      customerSnapshot: {
        id: fixture.customerAId,
        name: "Customer A",
        phone: "0900000001",
        email: "customer-a@example.com",
      },
      deviceSnapshot: {
        id: fixture.deviceAId,
        type: DeviceType.PHONE,
        brand: "Apple",
        model: "iPhone Test",
        color: "Black",
        serial: "SERIALA1234",
        imei: "123456789012345",
      },
    });
    expect(order.accessories).toEqual([
      expect.objectContaining({ name: "Charger", conditionNote: "Used condition" }),
    ]);
    expect(order.media).toEqual([
      expect.objectContaining({ id: mediaAssetId, uploadedAt: expect.any(Date), expiresAt: null }),
    ]);
    expect(order.events).toEqual([
      expect.objectContaining({
        eventType: "ORDER_CREATED",
        fromStatus: null,
        toStatus: RepairOrderStatus.RECEIVED,
        actorType: "USER",
        actorUserId: fixture.userIds[1],
        requestId: "req-intake-success",
      }),
    ]);
    expect(JSON.stringify(order.events)).not.toMatch(/password|passcode|pin/i);
  });

  it("replays an identical idempotent request and rejects a changed payload", async () => {
    const key = `order-retry-${randomUUID()}`;
    const payload = validPayload([await createMedia()]);
    const first = await createRequest().set("Idempotency-Key", key).send(payload).expect(201);
    const replay = await createRequest().set("Idempotency-Key", key).send(payload).expect(201);
    const conflict = await createRequest()
      .set("Idempotency-Key", key)
      .send({ ...payload, reportedProblem: "Changed problem" })
      .expect(409);

    expect(replay.body).toEqual(first.body);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await prisma.repairOrder.count({ where: { id: first.body.data.id } })).toBe(1);
  });

  it("hides cross-tenant resources and rolls back mismatched customer-device input", async () => {
    const initialOrders = await prisma.repairOrder.count({ where: { shopId: fixture.shopAId } });
    const crossTenant = await createRequest()
      .send({
        ...validPayload([await createMedia()]),
        branchId: fixture.branchBId,
        customerId: fixture.customerBId,
        deviceId: fixture.deviceBId,
      })
      .expect(404);
    const mismatchedMediaId = await createMedia();
    const mismatched = await createRequest()
      .send({
        ...validPayload([mismatchedMediaId]),
        deviceId: fixture.otherDeviceAId,
      })
      .expect(404);
    const crossTenantMedia = await createRequest()
      .send(validPayload([await createMedia({ shopId: fixture.shopBId })]))
      .expect(404);

    expect(crossTenant.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(mismatched.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(crossTenantMedia.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(await prisma.repairOrder.count({ where: { shopId: fixture.shopAId } })).toBe(
      initialOrders,
    );
    expect(
      await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mismatchedMediaId } }),
    ).toMatchObject({ repairOrderId: null, uploadedAt: null });
  });

  it("rejects missing photo count, incomplete upload and expired upload without partial writes", async () => {
    await prisma.shop.update({
      where: { id: fixture.shopAId },
      data: { intakePhotoMinimum: 2 },
    });
    const before = await prisma.repairOrder.count({ where: { shopId: fixture.shopAId } });
    const missing = await createRequest()
      .send(validPayload([await createMedia()]))
      .expect(409);
    await prisma.shop.update({
      where: { id: fixture.shopAId },
      data: { intakePhotoMinimum: 1 },
    });
    const incomplete = await createRequest()
      .send(validPayload([await createMedia({ complete: false })]))
      .expect(409);
    const expired = await createRequest()
      .send(validPayload([await createMedia({ expiresAt: new Date(Date.now() - 1_000) })]))
      .expect(409);

    expect(missing.body.error.code).toBe("INTAKE_PHOTOS_REQUIRED");
    expect(incomplete.body.error.code).toBe("MEDIA_UPLOAD_INCOMPLETE");
    expect(expired.body.error.code).toBe("MEDIA_UPLOAD_INCOMPLETE");
    expect(await prisma.repairOrder.count({ where: { shopId: fixture.shopAId } })).toBe(before);
  });

  it("rejects technicians, device credentials and client-controlled status or code", async () => {
    const denied = await createRequest(fixture.technicianToken)
      .send(validPayload([await createMedia()]))
      .expect(403);
    const sensitive = await createRequest()
      .send({
        ...validPayload([await createMedia()]),
        intakeCondition: "Screen scratched; PIN: 1234",
      })
      .expect(422);
    const controlled = await createRequest()
      .send({
        ...validPayload([await createMedia()]),
        status: "COMPLETED",
        code: "CLIENT-CODE",
      })
      .expect(422);
    const missingRequired = await createRequest()
      .send({
        branchId: fixture.branchAId,
        customerId: fixture.customerAId,
        deviceId: fixture.deviceAId,
        mediaAssetIds: [await createMedia()],
      })
      .expect(422);

    expect(denied.body.error.code).toBe("PERMISSION_DENIED");
    expect(sensitive.body.error.details).toEqual([
      expect.objectContaining({
        field: "intakeCondition",
        code: "DEVICE_CREDENTIAL_NOT_ALLOWED",
      }),
    ]);
    expect(controlled.body.error.code).toBe("VALIDATION_FAILED");
    expect(missingRequired.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("allocates unique sequential order numbers under concurrent creation", async () => {
    const assets = await Promise.all(Array.from({ length: 4 }, () => createMedia()));
    const responses = await Promise.all(
      assets.map((assetId) =>
        createRequest()
          .send(validPayload([assetId]))
          .expect(201),
      ),
    );
    const ids = responses.map((response) => response.body.data.id as string);
    const orders = await prisma.repairOrder.findMany({
      where: { id: { in: ids } },
      select: { code: true, orderNo: true },
    });

    expect(orders).toHaveLength(4);
    expect(new Set(orders.map((order) => order.orderNo)).size).toBe(4);
    expect(new Set(orders.map((order) => order.code)).size).toBe(4);
  });
});
