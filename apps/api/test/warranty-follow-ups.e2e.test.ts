import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  CompletionOutcome,
  DeviceType,
  MediaPurpose,
  MembershipRole,
  MembershipStatus,
  QuoteStatus,
  RepairOrderStatus,
  ServiceType,
  TokenScope,
} from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
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
import { PublicTokenService } from "../src/modules/public-access/public-token.service.js";

class FakeObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, StoredObjectMetadata>();
  failHead = false;

  presignPut(input: PresignPutInput): Promise<string> {
    return Promise.resolve(`https://storage.test/${encodeURIComponent(input.objectKey)}`);
  }

  head(objectKey: string): Promise<StoredObjectMetadata | null> {
    if (this.failHead) return Promise.reject(new Error("storage unavailable"));
    return Promise.resolve(this.objects.get(objectKey) ?? null);
  }

  delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
    return Promise.resolve();
  }
}

describe("RF-048 warranty follow-up and public projection", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let publicTokens: PublicTokenService;
  let shopAId: string;
  let shopBId: string;
  let branchAId: string;
  let branchBId: string;
  let customerAId: string;
  let customerBId: string;
  let deviceAId: string;
  let deviceBId: string;
  let ownerAId: string;
  let ownerToken: string;
  let receptionistToken: string;
  let technicianToken: string;
  let inactiveToken: string;
  let ownerBToken: string;
  let userIds: string[];
  let orderNo = 1;
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
    publicTokens = app.get(PublicTokenService);
    const tokens = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);
    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({
        data: {
          name: `Warranty A ${suffix}`,
          slug: `warranty-a-${suffix}`,
          orderCodePrefix: "WAR",
          intakePhotoMinimum: 1,
          contactPhone: "028-5555-0480",
        },
      }),
      prisma.shop.create({
        data: {
          name: `Warranty B ${suffix}`,
          slug: `warranty-b-${suffix}`,
          orderCodePrefix: "WRB",
          intakePhotoMinimum: 1,
        },
      }),
    ]);
    shopAId = shopA.id;
    shopBId = shopB.id;
    const [branchA, branchB, customerA, customerB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopAId, name: "Warranty A main" } }),
      prisma.branch.create({ data: { shopId: shopBId, name: "Warranty B main" } }),
      prisma.customer.create({
        data: {
          shopId: shopAId,
          name: "Sensitive Warranty Customer",
          phoneRaw: "0900000480",
          phoneNormalized: "+84900000480",
          email: "warranty-sensitive@example.com",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopBId,
          name: "Other Warranty Customer",
          phoneRaw: "0900000481",
          phoneNormalized: "+84900000481",
        },
      }),
    ]);
    branchAId = branchA.id;
    branchBId = branchB.id;
    customerAId = customerA.id;
    customerBId = customerB.id;
    const [deviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopAId,
          customerId: customerAId,
          type: DeviceType.LAPTOP,
          brand: "Acme",
          model: "WarrantyBook",
          serialNormalized: "WARRANTYSECRET1234",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopBId,
          customerId: customerBId,
          type: DeviceType.PHONE,
          brand: "Other",
          model: "Tenant",
        },
      }),
    ]);
    deviceAId = deviceA.id;
    deviceBId = deviceB.id;

    const specs = [
      ["Owner A", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopAId],
      ["Receptionist A", MembershipRole.RECEPTIONIST, MembershipStatus.ACTIVE, shopAId],
      ["Technician A", MembershipRole.TECHNICIAN, MembershipStatus.ACTIVE, shopAId],
      ["Inactive receptionist", MembershipRole.RECEPTIONIST, MembershipStatus.INACTIVE, shopAId],
      ["Owner B", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopBId],
    ] as const;
    const users = await Promise.all(
      specs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf048-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    userIds = users.map((user) => user.id);
    ownerAId = users[0]!.id;
    await prisma.shopMembership.createMany({
      data: specs.map(([, role, status, shopId], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status,
      })),
    });
    ownerToken = tokens.createAccessToken(users[0]!.id).token;
    receptionistToken = tokens.createAccessToken(users[1]!.id).token;
    technicianToken = tokens.createAccessToken(users[2]!.id).token;
    inactiveToken = tokens.createAccessToken(users[3]!.id).token;
    ownerBToken = tokens.createAccessToken(users[4]!.id).token;
  });

  afterAll(async () => {
    const shops = [shopAId, shopBId];
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.publicAccessToken.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.intakeAccessory.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.mediaAsset.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.warranty.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.quoteItem.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.quoteVersion.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.shop.deleteMany({ where: { id: { in: shops } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  async function createSource(options?: {
    shop?: "A" | "B";
    status?: RepairOrderStatus;
    outcome?: CompletionOutcome | null;
    warranty?: "active" | "expired" | "future" | "none";
  }) {
    const inA = options?.shop !== "B";
    const shopId = inA ? shopAId : shopBId;
    const number = orderNo++;
    const source = await prisma.repairOrder.create({
      data: {
        shopId,
        branchId: inA ? branchAId : branchBId,
        customerId: inA ? customerAId : customerBId,
        deviceId: inA ? deviceAId : deviceBId,
        orderNo: -number,
        code: `SOURCE-${number}`,
        status: options?.status ?? RepairOrderStatus.COMPLETED,
        completionOutcome:
          options && "outcome" in options ? options.outcome : CompletionOutcome.REPAIRED,
        reportedProblem: "PRIVATE source problem",
        intakeCondition: "PRIVATE source condition",
        consentAcknowledgedAt: new Date(Date.now() - 10_000),
        customerSnapshot: {
          name: "Immutable Snapshot Customer",
          phone: "0911111111",
          email: "snapshot-private@example.com",
        },
        deviceSnapshot: {
          type: "LAPTOP",
          brand: "Acme",
          model: "WarrantyBook",
          serial: "SN-SNAPSHOT-PRIVATE",
        },
        receivedAt: new Date(Date.now() - 86_400_000),
        returnedAt: new Date(Date.now() - 10_000),
        createdByUserId: ownerAId,
      },
    });
    const warrantyKind = options?.warranty ?? "active";
    if (warrantyKind !== "none") {
      const now = Date.now();
      await prisma.warranty.create({
        data: {
          shopId,
          repairOrderId: source.id,
          startsAt: new Date(warrantyKind === "future" ? now + 60_000 : now - 60_000),
          endsAt: new Date(warrantyKind === "expired" ? now - 1_000 : now + 86_400_000),
          termsSnapshot: "Customer-safe 30 day parts warranty",
        },
      });
    }
    await prisma.orderEvent.create({
      data: {
        shopId,
        repairOrderId: source.id,
        eventType: "SOURCE_COMPLETED",
        actorType: "SYSTEM",
        publicPayload: { message: "Source completed." },
        privatePayload: { secret: "source-event-private" },
        requestId: `source-${number}`,
      },
    });
    return source;
  }

  async function createMedia(options?: {
    shopId?: string;
    complete?: boolean;
    expiresAt?: Date;
    purpose?: MediaPurpose;
    mimeType?: string;
    byteSize?: number;
  }) {
    const shopId = options?.shopId ?? shopAId;
    const objectKey = `shops/${shopId}/intake/${randomUUID()}.jpg`;
    const asset = await prisma.mediaAsset.create({
      data: {
        shopId,
        purpose: options?.purpose ?? MediaPurpose.INTAKE,
        objectKey,
        originalName: "warranty.jpg",
        mimeType: options?.mimeType ?? "image/jpeg",
        byteSize: options?.byteSize ?? 512,
        uploadedByUserId: ownerAId,
        expiresAt: options?.expiresAt ?? new Date(Date.now() + 60_000),
      },
    });
    if (options?.complete !== false) {
      storage.objects.set(objectKey, {
        mimeType: options?.mimeType ?? "image/jpeg",
        byteSize: options?.byteSize ?? 512,
        checksumSha256: null,
      });
    }
    return asset;
  }

  function payload(mediaIds: string[]) {
    return {
      eligibilityConfirmed: true,
      branchId: branchAId,
      priority: "HIGH",
      reportedProblem: "Battery issue returned during warranty",
      intakeCondition: "Small scratch on the lower case",
      consentAccepted: true,
      promisedAt: null,
      accessories: [{ name: "Charger", conditionNote: "Used" }],
      intakeMediaAssetIds: mediaIds,
    };
  }

  function createRequest(
    sourceId: string,
    options?: { token?: string; shopId?: string; key?: string },
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${sourceId}/warranty-orders`)
      .set("Authorization", `Bearer ${options?.token ?? ownerToken}`)
      .set("X-Shop-Id", options?.shopId ?? shopAId)
      .set("Idempotency-Key", options?.key ?? `rf048-${randomUUID()}`);
  }

  it("creates owner and receptionist follow-ups with copied snapshots and immutable source history", async () => {
    const source = await createSource();
    const sourceBefore = await prisma.repairOrder.findUniqueOrThrow({ where: { id: source.id } });
    const sourceEventsBefore = await prisma.orderEvent.findMany({
      where: { repairOrderId: source.id },
      orderBy: { id: "asc" },
    });
    const media = await createMedia();
    const created = await createRequest(source.id)
      .send(payload([media.id]))
      .expect(201);

    expect(created.body.data).toMatchObject({
      serviceType: ServiceType.WARRANTY,
      sourceOrderId: source.id,
      status: RepairOrderStatus.RECEIVED,
      priority: "HIGH",
      sourceOrder: { code: source.code, status: RepairOrderStatus.COMPLETED },
      followUpOrders: [],
      quoteVersions: [],
      workLogs: [],
      payments: [],
      qcRuns: [],
      handover: null,
      warranty: null,
    });
    expect(created.body.data.customer.name).toBe("Immutable Snapshot Customer");
    expect(created.body.data.device.brand).toBe("Acme");
    expect(created.body.data.timeline).toHaveLength(1);
    expect(created.body.data.timeline[0].eventType).toBe("warranty_case.opened");

    const child = await prisma.repairOrder.findUniqueOrThrow({
      where: { id: created.body.data.id as string },
      include: { accessories: true, media: true, events: true },
    });
    expect(child.customerSnapshot).toEqual(sourceBefore.customerSnapshot);
    expect(child.deviceSnapshot).toEqual(sourceBefore.deviceSnapshot);
    expect(child.accessories).toHaveLength(1);
    expect(child.media.map((item) => item.id)).toEqual([media.id]);
    expect(child.events.map((event) => event.eventType)).toEqual(["warranty_case.opened"]);

    expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: source.id } })).toEqual(
      sourceBefore,
    );
    expect(
      await prisma.orderEvent.findMany({
        where: { repairOrderId: source.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(sourceEventsBefore);

    const sourceDetail = await request(app.getHttpServer())
      .get(`/api/v1/repair-orders/${source.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("X-Shop-Id", shopAId)
      .expect(200);
    expect(sourceDetail.body.data.followUpOrders).toEqual([
      expect.objectContaining({ code: child.code, serviceType: ServiceType.WARRANTY }),
    ]);

    const secondSource = await createSource();
    const secondMedia = await createMedia();
    await createRequest(secondSource.id, { token: receptionistToken })
      .send(payload([secondMedia.id]))
      .expect(201);
  });

  it("enforces role, active membership, and tenant-not-found boundaries", async () => {
    const source = await createSource();
    const media = await createMedia();
    await createRequest(source.id, { token: technicianToken })
      .send(payload([media.id]))
      .expect(403);
    await createRequest(source.id, { token: inactiveToken })
      .send(payload([media.id]))
      .expect(403);
    const cross = await createRequest(source.id, { token: ownerBToken, shopId: shopBId })
      .send({ ...payload([media.id]), branchId: branchBId })
      .expect(404);
    expect(cross.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("rejects invalid source state, absent/inactive warranty, and missing/false confirmation", async () => {
    const cases = [
      [
        await createSource({ status: RepairOrderStatus.READY_FOR_PICKUP }),
        "WARRANTY_SOURCE_INVALID",
      ],
      [await createSource({ outcome: CompletionOutcome.UNREPAIRABLE }), "WARRANTY_SOURCE_INVALID"],
      [await createSource({ warranty: "none" }), "WARRANTY_SOURCE_INVALID"],
      [await createSource({ warranty: "expired" }), "WARRANTY_NOT_ELIGIBLE"],
      [await createSource({ warranty: "future" }), "WARRANTY_NOT_ELIGIBLE"],
    ] as const;
    for (const [source, errorCode] of cases) {
      const media = await createMedia();
      const response = await createRequest(source.id)
        .send(payload([media.id]))
        .expect(409);
      expect(response.body.error.code).toBe(errorCode);
    }

    const source = await createSource();
    const media = await createMedia();
    const falseConfirmation = await createRequest(source.id)
      .send({ ...payload([media.id]), eligibilityConfirmed: false })
      .expect(409);
    expect(falseConfirmation.body.error.code).toBe("WARRANTY_NOT_ELIGIBLE");
    const missing = payload([media.id]) as Record<string, unknown>;
    delete missing.eligibilityConfirmed;
    expect((await createRequest(source.id).send(missing).expect(422)).body.error.code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("allows archived source identities and still copies the immutable source snapshots", async () => {
    const source = await createSource();
    await prisma.device.update({ where: { id: deviceAId }, data: { archivedAt: new Date() } });
    await prisma.customer.update({ where: { id: customerAId }, data: { archivedAt: new Date() } });
    const media = await createMedia();
    const response = await createRequest(source.id)
      .send(payload([media.id]))
      .expect(201);
    const child = await prisma.repairOrder.findUniqueOrThrow({
      where: { id: response.body.data.id },
    });
    expect(child.customerSnapshot).toEqual(source.customerSnapshot);
    expect(child.deviceSnapshot).toEqual(source.deviceSnapshot);
    await prisma.device.update({ where: { id: deviceAId }, data: { archivedAt: null } });
    await prisma.customer.update({ where: { id: customerAId }, data: { archivedAt: null } });
  });

  it("applies normal evidence ownership, purpose, expiry, upload, and credential rules", async () => {
    const attempts = [
      await createMedia({ complete: false }),
      await createMedia({ expiresAt: new Date(Date.now() - 1000) }),
      await createMedia({ purpose: MediaPurpose.QC }),
      await createMedia({ shopId: shopBId }),
      await createMedia({ mimeType: "application/pdf" }),
      await createMedia({ byteSize: 15_000_001 }),
    ];
    const expected = [409, 409, 404, 404, 409, 409];
    for (let index = 0; index < attempts.length; index += 1) {
      const source = await createSource();
      await createRequest(source.id)
        .send(payload([attempts[index]!.id]))
        .expect(expected[index]!);
    }
    const source = await createSource();
    const media = await createMedia();
    const response = await createRequest(source.id)
      .send({ ...payload([media.id]), intakeCondition: "PIN: 1234" })
      .expect(422);
    expect(response.body.error.details[0].code).toBe("DEVICE_CREDENTIAL_NOT_ALLOWED");

    const consentSource = await createSource();
    const consentMedia = await createMedia();
    await createRequest(consentSource.id)
      .send({ ...payload([consentMedia.id]), consentAccepted: false })
      .expect(422);

    const minimumSource = await createSource();
    const minimumMedia = await createMedia();
    await prisma.shop.update({ where: { id: shopAId }, data: { intakePhotoMinimum: 2 } });
    try {
      const minimum = await createRequest(minimumSource.id)
        .send(payload([minimumMedia.id]))
        .expect(409);
      expect(minimum.body.error.code).toBe("INTAKE_PHOTOS_REQUIRED");
    } finally {
      await prisma.shop.update({ where: { id: shopAId }, data: { intakePhotoMinimum: 1 } });
    }

    const unavailableSource = await createSource();
    const unavailableMedia = await createMedia();
    storage.failHead = true;
    try {
      const unavailable = await createRequest(unavailableSource.id)
        .send(payload([unavailableMedia.id]))
        .expect(503);
      expect(unavailable.body.error.code).toBe("STORAGE_UNAVAILABLE");
    } finally {
      storage.failHead = false;
    }
  });

  it("replays one result, rejects mismatched payloads, permits future cases, and allocates unique codes", async () => {
    const source = await createSource();
    const media = await createMedia();
    const key = `rf048-replay-${randomUUID()}`;
    const first = await createRequest(source.id, { key })
      .send(payload([media.id]))
      .expect(201);
    const replay = await createRequest(source.id, { key })
      .send(payload([media.id]))
      .expect(201);
    expect(replay.body).toEqual(first.body);
    const mismatch = await createRequest(source.id, { key })
      .send({ ...payload([media.id]), reportedProblem: "Different payload" })
      .expect(409);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const secondMedia = await createMedia();
    const second = await createRequest(source.id)
      .send(payload([secondMedia.id]))
      .expect(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);

    const sources = await Promise.all([createSource(), createSource(), createSource()]);
    const mediaAssets = await Promise.all([createMedia(), createMedia(), createMedia()]);
    const concurrent = await Promise.all(
      sources.map((item, index) =>
        createRequest(item.id)
          .send(payload([mediaAssets[index]!.id]))
          .expect(201),
      ),
    );
    expect(new Set(concurrent.map((item) => item.body.data.code)).size).toBe(3);

    const retrySource = await createSource();
    const retryMedia = await createMedia();
    const retryKey = `rf048-concurrent-retry-${randomUUID()}`;
    const duplicateRetry = await Promise.all([
      createRequest(retrySource.id, { key: retryKey }).send(payload([retryMedia.id])),
      createRequest(retrySource.id, { key: retryKey }).send(payload([retryMedia.id])),
    ]);
    expect(duplicateRetry.map((response) => response.status)).toEqual([201, 201]);
    expect(duplicateRetry[0]!.body.data.id).toBe(duplicateRetry[1]!.body.data.id);
    expect(await prisma.repairOrder.count({ where: { sourceOrderId: retrySource.id } })).toBe(1);
  });

  it("rolls back child, media binding, event, and idempotency when the child event fails", async () => {
    const source = await createSource();
    const media = await createMedia();
    const key = `rf048-rollback-${randomUUID()}`;
    const idempotencyCountBefore = await prisma.idempotencyRecord.count({
      where: { shopId: shopAId, scope: "warranty-orders.create" },
    });
    const functionName = `rf048_fail_${randomUUID().replaceAll("-", "")}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW."eventType" = 'warranty_case.opened' THEN
          RAISE EXCEPTION 'rf048 injected event failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER ${functionName}_trigger BEFORE INSERT ON order_events
      FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `);
    try {
      await createRequest(source.id, { key })
        .send(payload([media.id]))
        .expect(500);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${functionName}_trigger ON order_events`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
    expect(await prisma.repairOrder.count({ where: { sourceOrderId: source.id } })).toBe(0);
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: media.id } })).repairOrderId,
    ).toBeNull();
    expect(
      await prisma.idempotencyRecord.count({
        where: { shopId: shopAId, scope: "warranty-orders.create" },
      }),
    ).toBe(idempotencyCountBefore);
    await createRequest(source.id, { key })
      .send(payload([media.id]))
      .expect(201);
  });

  it("projects warranty and linked progress only through valid TRACK_ORDER tokens", async () => {
    const source = await createSource();
    const media = await createMedia();
    const child = await createRequest(source.id)
      .send(payload([media.id]))
      .expect(201);
    const rawTrack = randomBytes(32).toString("base64url");
    await prisma.publicAccessToken.create({
      data: {
        shopId: shopAId,
        repairOrderId: source.id,
        scope: TokenScope.TRACK_ORDER,
        tokenHash: publicTokens.hash(rawTrack),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const tracked = await request(app.getHttpServer())
      .get(`/public/v1/orders/${rawTrack}`)
      .expect(200);
    expect(tracked.body.data.warranty).toEqual({
      startsAt: expect.any(String),
      endsAt: expect.any(String),
      terms: "Customer-safe 30 day parts warranty",
      status: "ACTIVE",
    });
    expect(tracked.body.data.linkedOrders).toEqual([
      expect.objectContaining({
        code: child.body.data.code,
        serviceType: ServiceType.WARRANTY,
        status: RepairOrderStatus.RECEIVED,
      }),
    ]);
    expect(tracked.body.data).toMatchObject({ readyAt: null, returnedAt: expect.any(String) });

    const serialized = JSON.stringify(tracked.body);
    for (const secret of [
      source.id,
      child.body.data.id as string,
      customerAId,
      deviceAId,
      ownerAId,
      "warranty-sensitive@example.com",
      "0911111111",
      "SN-SNAPSHOT-PRIVATE",
      "PRIVATE source problem",
      "source-event-private",
      media.objectKey,
    ]) {
      expect(serialized).not.toContain(secret);
    }

    const quote = await prisma.quoteVersion.create({
      data: {
        shopId: shopAId,
        repairOrderId: source.id,
        versionNo: 1,
        status: QuoteStatus.SENT,
        currency: "VND",
        subtotal: 0,
        discount: 0,
        total: 0,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        createdByUserId: ownerAId,
      },
    });
    const rawDecision = randomBytes(32).toString("base64url");
    await prisma.publicAccessToken.create({
      data: {
        shopId: shopAId,
        repairOrderId: source.id,
        quoteVersionId: quote.id,
        scope: TokenScope.DECIDE_QUOTE,
        tokenHash: publicTokens.hash(rawDecision),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const decisionRead = await request(app.getHttpServer())
      .get(`/public/v1/orders/${rawDecision}`)
      .expect(200);
    expect(decisionRead.body.data.warranty).toBeNull();
    expect(decisionRead.body.data.linkedOrders).toEqual([]);

    for (const tokenState of ["expired", "revoked"] as const) {
      const raw = randomBytes(32).toString("base64url");
      await prisma.publicAccessToken.create({
        data: {
          shopId: shopAId,
          repairOrderId: source.id,
          scope: TokenScope.TRACK_ORDER,
          tokenHash: publicTokens.hash(raw),
          expiresAt: new Date(Date.now() + (tokenState === "expired" ? -1000 : 60_000)),
          revokedAt: tokenState === "revoked" ? new Date() : null,
        },
      });
      await request(app.getHttpServer())
        .get(`/public/v1/orders/${raw}`)
        .expect(tokenState === "expired" ? 410 : 404);
    }
  });
});
