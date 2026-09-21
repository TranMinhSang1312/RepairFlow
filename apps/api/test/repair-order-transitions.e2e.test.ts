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

interface Fixture {
  shopAId: string;
  shopBId: string;
  branchAId: string;
  branchBId: string;
  customerAId: string;
  customerBId: string;
  deviceAId: string;
  deviceBId: string;
  ownerId: string;
  technicianId: string;
  ownerToken: string;
  receptionistToken: string;
  technicianToken: string;
  userIds: string[];
}

describe("repair-order transition API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let nextOrderNo = 1;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);

    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({
        data: { name: `Transitions A ${suffix}`, slug: `transitions-a-${suffix}` },
      }),
      prisma.shop.create({
        data: { name: `Transitions B ${suffix}`, slug: `transitions-b-${suffix}` },
      }),
    ]);
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopA.id, name: "Main A" } }),
      prisma.branch.create({ data: { shopId: shopB.id, name: "Main B" } }),
    ]);
    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "Transition Customer A",
          phoneRaw: "0900000041",
          phoneNormalized: "+84900000041",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "Transition Customer B",
          phoneRaw: "0900000042",
          phoneNormalized: "+84900000042",
        },
      }),
    ]);
    const [deviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopA.id,
          customerId: customerA.id,
          type: DeviceType.PHONE,
          brand: "Test",
          model: "A",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopB.id,
          customerId: customerB.id,
          type: DeviceType.LAPTOP,
          brand: "Test",
          model: "B",
        },
      }),
    ]);
    const specs = [
      ["Owner A", MembershipRole.OWNER, shopA.id],
      ["Receptionist A", MembershipRole.RECEPTIONIST, shopA.id],
      ["Technician A", MembershipRole.TECHNICIAN, shopA.id],
      ["Owner B", MembershipRole.OWNER, shopB.id],
    ] as const;
    const users = await Promise.all(
      specs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf032-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    await prisma.shopMembership.createMany({
      data: specs.map(([, role, shopId], index) => ({
        shopId,
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
      deviceAId: deviceA.id,
      deviceBId: deviceB.id,
      ownerId: users[0]!.id,
      technicianId: users[2]!.id,
      ownerToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteVersion.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.assignment.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.mediaAsset.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await app.close();
  });

  async function createOrder(options?: {
    shop?: "A" | "B";
    status?: RepairOrderStatus;
    assigned?: boolean;
    photo?: boolean;
  }): Promise<string> {
    const shopA = options?.shop !== "B";
    const shopId = shopA ? fixture.shopAId : fixture.shopBId;
    const branchId = shopA ? fixture.branchAId : fixture.branchBId;
    const customerId = shopA ? fixture.customerAId : fixture.customerBId;
    const deviceId = shopA ? fixture.deviceAId : fixture.deviceBId;
    const orderNo = nextOrderNo++;
    const order = await prisma.repairOrder.create({
      data: {
        shopId,
        branchId,
        customerId,
        deviceId,
        orderNo,
        code: `TRANSITION-${shopA ? "A" : "B"}-${orderNo}`,
        status: options?.status ?? RepairOrderStatus.RECEIVED,
        reportedProblem: "Test problem",
        intakeCondition: "Device has visible scratches",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "Snapshot customer", phone: "0900000000" },
        deviceSnapshot: { type: DeviceType.PHONE, brand: "Test", model: "Snapshot" },
        createdByUserId: shopA ? fixture.ownerId : fixture.userIds[3]!,
      },
    });
    if (shopA && options?.assigned) {
      await prisma.assignment.create({
        data: {
          shopId,
          repairOrderId: order.id,
          technicianUserId: fixture.technicianId,
          assignedByUserId: fixture.ownerId,
        },
      });
    }
    if (shopA && options?.photo) {
      await prisma.mediaAsset.create({
        data: {
          shopId,
          repairOrderId: order.id,
          purpose: MediaPurpose.INTAKE,
          objectKey: `shops/${shopId}/intake/${randomUUID()}.jpg`,
          originalName: "intake.jpg",
          mimeType: "image/jpeg",
          byteSize: 128,
          uploadedByUserId: fixture.ownerId,
          uploadedAt: new Date(),
          expiresAt: null,
        },
      });
    }
    return order.id;
  }

  function transitionRequest(
    orderId: string,
    token = fixture.ownerToken,
    shopId = fixture.shopAId,
    key = `transition-${randomUUID()}`,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/transition`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", shopId)
      .set("Idempotency-Key", key);
  }

  const payload = (targetStatus: RepairOrderStatus, expectedLockVersion = 0) => ({
    targetStatus,
    expectedLockVersion,
  });

  it("starts diagnosis atomically and allows the actively assigned technician", async () => {
    const ownerOrderId = await createOrder({ assigned: true, photo: true });
    const ownerResponse = await transitionRequest(ownerOrderId)
      .set("X-Request-Id", "req-rf032-owner")
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(200);
    expect(ownerResponse.body.data).toMatchObject({
      id: ownerOrderId,
      status: RepairOrderStatus.DIAGNOSING,
      lockVersion: 1,
      assignedTechnicianUserId: fixture.technicianId,
    });
    expect(
      await prisma.orderEvent.findFirstOrThrow({
        where: { repairOrderId: ownerOrderId, eventType: "ORDER_STATUS_CHANGED" },
      }),
    ).toMatchObject({
      fromStatus: RepairOrderStatus.RECEIVED,
      toStatus: RepairOrderStatus.DIAGNOSING,
      actorUserId: fixture.ownerId,
      requestId: "req-rf032-owner",
    });

    const technicianOrderId = await createOrder({ assigned: true, photo: true });
    await transitionRequest(technicianOrderId, fixture.technicianToken)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(200);
  });

  it("enforces role rules for start diagnosis, void, and return to diagnosis", async () => {
    const receptionistOrder = await createOrder({ assigned: true, photo: true });
    const deniedStart = await transitionRequest(receptionistOrder, fixture.receptionistToken)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(403);
    expect(deniedStart.body.error.code).toBe("PERMISSION_DENIED");

    const voidOrder = await createOrder();
    await transitionRequest(voidOrder).send(payload(RepairOrderStatus.VOIDED)).expect(200);
    const receptionistVoid = await createOrder();
    await transitionRequest(receptionistVoid, fixture.receptionistToken)
      .send(payload(RepairOrderStatus.VOIDED))
      .expect(403);

    const awaitingOrder = await createOrder({ status: RepairOrderStatus.AWAITING_APPROVAL });
    await transitionRequest(awaitingOrder, fixture.receptionistToken)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(200);
  });

  it("rejects missing intake evidence and void history without partial writes", async () => {
    const noAssignment = await createOrder({ photo: true });
    const assignmentFailure = await transitionRequest(noAssignment)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(409);
    expect(assignmentFailure.body.error.code).toBe("TECHNICIAN_NOT_ASSIGNED");

    const noPhoto = await createOrder({ assigned: true });
    const photoFailure = await transitionRequest(noPhoto)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(409);
    expect(photoFailure.body.error.code).toBe("INTAKE_PHOTOS_REQUIRED");

    const withQuote = await createOrder();
    await prisma.quoteVersion.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: withQuote,
        versionNo: 1,
        createdByUserId: fixture.ownerId,
      },
    });
    const historyFailure = await transitionRequest(withQuote)
      .send(payload(RepairOrderStatus.VOIDED))
      .expect(409);
    expect(historyFailure.body.error.code).toBe("REPAIR_ORDER_GUARD_FAILED");

    for (const orderId of [noAssignment, noPhoto, withQuote]) {
      expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
        status: RepairOrderStatus.RECEIVED,
        lockVersion: 0,
      });
      expect(
        await prisma.orderEvent.count({
          where: { repairOrderId: orderId, eventType: "ORDER_STATUS_CHANGED" },
        }),
      ).toBe(0);
    }
  });

  it("rejects unsupported, stale, cross-tenant, and unassigned-technician requests", async () => {
    const unsupported = await createOrder({ assigned: true, photo: true });
    const unsupportedResponse = await transitionRequest(unsupported)
      .send(payload(RepairOrderStatus.APPROVED))
      .expect(409);
    expect(unsupportedResponse.body.error.code).toBe("REPAIR_ORDER_INVALID_TRANSITION");

    const stale = await createOrder({ assigned: true, photo: true });
    const staleResponse = await transitionRequest(stale)
      .send(payload(RepairOrderStatus.DIAGNOSING, 9))
      .expect(409);
    expect(staleResponse.body.error.code).toBe("CONCURRENT_UPDATE");

    const crossTenant = await createOrder({ shop: "B" });
    const crossResponse = await transitionRequest(crossTenant)
      .send(payload(RepairOrderStatus.VOIDED))
      .expect(404);
    expect(crossResponse.body.error.code).toBe("RESOURCE_NOT_FOUND");

    const unassigned = await createOrder({ photo: true });
    const unassignedResponse = await transitionRequest(unassigned, fixture.technicianToken)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(404);
    expect(unassignedResponse.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("replays the same idempotency key and rejects a changed payload", async () => {
    const orderId = await createOrder({ assigned: true, photo: true });
    const key = `rf032-retry-${randomUUID()}`;
    const first = await transitionRequest(orderId, fixture.ownerToken, fixture.shopAId, key)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(200);
    const replay = await transitionRequest(orderId, fixture.ownerToken, fixture.shopAId, key)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(200);
    const mismatch = await transitionRequest(orderId, fixture.ownerToken, fixture.shopAId, key)
      .send({ ...payload(RepairOrderStatus.DIAGNOSING), reason: "changed" })
      .expect(409);

    expect(replay.body).toEqual(first.body);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      await prisma.orderEvent.count({
        where: { repairOrderId: orderId, eventType: "ORDER_STATUS_CHANGED" },
      }),
    ).toBe(1);
  });

  it("allows only one concurrent request to win from a lock version", async () => {
    const orderId = await createOrder({ assigned: true, photo: true });
    const [first, second] = await Promise.all([
      transitionRequest(orderId).send(payload(RepairOrderStatus.DIAGNOSING)),
      transitionRequest(orderId).send(payload(RepairOrderStatus.DIAGNOSING)),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(
      await prisma.orderEvent.count({
        where: { repairOrderId: orderId, eventType: "ORDER_STATUS_CHANGED" },
      }),
    ).toBe(1);
    expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      status: RepairOrderStatus.DIAGNOSING,
      lockVersion: 1,
    });
  });

  it("rolls back status, event, and idempotency when event persistence fails", async () => {
    const orderId = await createOrder({ assigned: true, photo: true });
    const key = `rf032-rollback-${randomUUID()}`;
    const idempotencyCountBefore = await prisma.idempotencyRecord.count({
      where: { shopId: fixture.shopAId, scope: "repair-orders.transition" },
    });
    const functionName = `rf032_fail_event_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const triggerName = `${functionName}_trigger`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."repairOrderId" = '${orderId}'::uuid THEN
          RAISE EXCEPTION 'forced RF-032 event failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "order_events"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);

    try {
      await transitionRequest(orderId, fixture.ownerToken, fixture.shopAId, key)
        .send(payload(RepairOrderStatus.DIAGNOSING))
        .expect(500);
      expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
        status: RepairOrderStatus.RECEIVED,
        lockVersion: 0,
      });
      expect(await prisma.orderEvent.count({ where: { repairOrderId: orderId } })).toBe(0);
      expect(
        await prisma.idempotencyRecord.count({
          where: { shopId: fixture.shopAId, scope: "repair-orders.transition" },
        }),
      ).toBe(idempotencyCountBefore);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "order_events";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  });
});
