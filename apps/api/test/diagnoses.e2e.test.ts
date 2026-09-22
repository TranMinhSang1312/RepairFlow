import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DeviceType, MembershipRole, MembershipStatus, RepairOrderStatus } from "@prisma/client";
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
  ownerAId: string;
  ownerBId: string;
  technicianId: string;
  ownerToken: string;
  receptionistToken: string;
  technicianToken: string;
  inactiveTechnicianToken: string;
  userIds: string[];
}

describe("append-only diagnosis API", () => {
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
        data: { name: `Diagnosis A ${suffix}`, slug: `diagnosis-a-${suffix}` },
      }),
      prisma.shop.create({
        data: { name: `Diagnosis B ${suffix}`, slug: `diagnosis-b-${suffix}` },
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
          name: "Diagnosis Customer A",
          phoneRaw: "0900000051",
          phoneNormalized: "+84900000051",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "Diagnosis Customer B",
          phoneRaw: "0900000052",
          phoneNormalized: "+84900000052",
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

    const userSpecs = [
      ["Owner A", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopA.id],
      ["Receptionist A", MembershipRole.RECEPTIONIST, MembershipStatus.ACTIVE, shopA.id],
      ["Technician A", MembershipRole.TECHNICIAN, MembershipStatus.ACTIVE, shopA.id],
      ["Inactive Technician", MembershipRole.TECHNICIAN, MembershipStatus.INACTIVE, shopA.id],
      ["Owner B", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopB.id],
    ] as const;
    const users = await Promise.all(
      userSpecs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf033-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    await prisma.shopMembership.createMany({
      data: userSpecs.map(([, role, status, shopId], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status,
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
      ownerAId: users[0]!.id,
      ownerBId: users[4]!.id,
      technicianId: users[2]!.id,
      ownerToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      inactiveTechnicianToken: tokenService.createAccessToken(users[3]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.diagnosis.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.assignment.deleteMany({ where: { shopId: { in: shopIds } } });
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
  }): Promise<string> {
    const isShopA = options?.shop !== "B";
    const shopId = isShopA ? fixture.shopAId : fixture.shopBId;
    const orderNo = nextOrderNo++;
    const order = await prisma.repairOrder.create({
      data: {
        shopId,
        branchId: isShopA ? fixture.branchAId : fixture.branchBId,
        customerId: isShopA ? fixture.customerAId : fixture.customerBId,
        deviceId: isShopA ? fixture.deviceAId : fixture.deviceBId,
        orderNo,
        code: `DIAG-${isShopA ? "A" : "B"}-${orderNo}`,
        status: options?.status ?? RepairOrderStatus.DIAGNOSING,
        reportedProblem: "Test problem",
        intakeCondition: "Used condition",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "Customer snapshot", phone: "0900000000" },
        deviceSnapshot: { type: DeviceType.PHONE, brand: "Test", model: "Snapshot" },
        createdByUserId: isShopA ? fixture.ownerAId : fixture.ownerBId,
      },
    });
    if (isShopA && options?.assigned) {
      await prisma.assignment.create({
        data: {
          shopId,
          repairOrderId: order.id,
          technicianUserId: fixture.technicianId,
          assignedByUserId: fixture.ownerAId,
        },
      });
    }
    return order.id;
  }

  function createRequest(orderId: string, token = fixture.ownerToken, shopId = fixture.shopAId) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/diagnoses`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", shopId);
  }

  const payload = (suffix = "initial") => ({
    finding: `Private technical finding ${suffix}`,
    recommendation: `Private technical recommendation ${suffix}`,
  });

  it("lets an owner publish and exposes ordered staff history with a safe timeline", async () => {
    const orderId = await createOrder();
    const first = await createRequest(orderId)
      .set("X-Request-Id", "req-rf033-owner")
      .send(payload())
      .expect(201);
    expect(first.body.data).toMatchObject({
      repairOrderId: orderId,
      revisionNo: 1,
      ...payload(),
      supersedesId: null,
      createdByUserId: fixture.ownerAId,
    });

    const event = await prisma.orderEvent.findFirstOrThrow({
      where: { repairOrderId: orderId, eventType: "DIAGNOSIS_PUBLISHED" },
    });
    expect(event).toMatchObject({ actorUserId: fixture.ownerAId, requestId: "req-rf033-owner" });
    expect(JSON.stringify(event.publicPayload)).not.toContain("Private technical");

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/repair-orders/${orderId}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(200);
    expect(detail.body.data.diagnoses).toEqual([first.body.data]);
    const publicTimeline = detail.body.data.timeline.find(
      (entry: { eventType: string }) => entry.eventType === "DIAGNOSIS_PUBLISHED",
    );
    expect(JSON.stringify(publicTimeline)).not.toContain("Private technical");
  });

  it("creates a correction without changing the prior revision", async () => {
    const orderId = await createOrder();
    const first = await createRequest(orderId).send(payload("v1")).expect(201);
    const second = await createRequest(orderId)
      .send({ ...payload("v2"), supersedesId: first.body.data.id })
      .expect(201);

    expect(second.body.data).toMatchObject({
      revisionNo: 2,
      supersedesId: first.body.data.id,
    });
    const history = await prisma.diagnosis.findMany({
      where: { repairOrderId: orderId },
      orderBy: { revisionNo: "asc" },
    });
    expect(history.map((entry) => entry.revisionNo)).toEqual([1, 2]);
    expect(history[0]).toMatchObject(payload("v1"));
    expect(history[1]).toMatchObject(payload("v2"));
  });

  it("enforces the role, active assignment, membership, and state matrix", async () => {
    const assignedOrder = await createOrder({ assigned: true });
    await createRequest(assignedOrder, fixture.technicianToken)
      .send(payload("technician"))
      .expect(201);

    const receptionistOrder = await createOrder();
    const receptionist = await createRequest(receptionistOrder, fixture.receptionistToken)
      .send(payload("receptionist"))
      .expect(403);
    expect(receptionist.body.error.code).toBe("PERMISSION_DENIED");

    const unassignedOrder = await createOrder();
    const unassigned = await createRequest(unassignedOrder, fixture.technicianToken)
      .send(payload("unassigned"))
      .expect(404);
    expect(unassigned.body.error.code).toBe("RESOURCE_NOT_FOUND");

    await createRequest(assignedOrder, fixture.inactiveTechnicianToken)
      .send(payload("inactive"))
      .expect(403);

    const wrongStateOrder = await createOrder({ status: RepairOrderStatus.RECEIVED });
    const wrongState = await createRequest(wrongStateOrder)
      .send(payload("wrong-state"))
      .expect(409);
    expect(wrongState.body.error.code).toBe("REPAIR_ORDER_GUARD_FAILED");
  });

  it("hides cross-tenant orders and invalid supersedes references", async () => {
    const crossTenantOrder = await createOrder({ shop: "B" });
    const crossTenantDiagnosis = await prisma.diagnosis.create({
      data: {
        shopId: fixture.shopBId,
        repairOrderId: crossTenantOrder,
        revisionNo: 1,
        ...payload("shop-b"),
        createdByUserId: fixture.ownerBId,
      },
    });
    const crossTenant = await createRequest(crossTenantOrder)
      .send(payload("cross-tenant"))
      .expect(404);
    expect(crossTenant.body.error.code).toBe("RESOURCE_NOT_FOUND");

    const sourceOrder = await createOrder();
    const source = await createRequest(sourceOrder).send(payload("source")).expect(201);
    const targetOrder = await createOrder();
    const mismatch = await createRequest(targetOrder)
      .send({ ...payload("mismatch"), supersedesId: source.body.data.id })
      .expect(404);
    expect(mismatch.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(await prisma.diagnosis.count({ where: { repairOrderId: targetOrder } })).toBe(0);

    const crossReferenceOrder = await createOrder();
    const crossReference = await createRequest(crossReferenceOrder)
      .send({ ...payload("cross-reference"), supersedesId: crossTenantDiagnosis.id })
      .expect(404);
    expect(crossReference.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(await prisma.diagnosis.count({ where: { repairOrderId: crossReferenceOrder } })).toBe(0);
  });

  it("allocates distinct sequential revisions under concurrency", async () => {
    const orderId = await createOrder();
    const [first, second] = await Promise.all([
      createRequest(orderId).send(payload("concurrent-a")),
      createRequest(orderId).send(payload("concurrent-b")),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const revisions = await prisma.diagnosis.findMany({
      where: { repairOrderId: orderId },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true },
    });
    expect(revisions).toEqual([{ revisionNo: 1 }, { revisionNo: 2 }]);
  });

  it("rolls back the diagnosis when timeline persistence fails", async () => {
    const orderId = await createOrder();
    const functionName = `rf033_fail_event_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const triggerName = `${functionName}_trigger`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."repairOrderId" = '${orderId}'::uuid THEN
          RAISE EXCEPTION 'forced RF-033 event failure';
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
      await createRequest(orderId).send(payload("rollback")).expect(500);
      expect(await prisma.diagnosis.count({ where: { repairOrderId: orderId } })).toBe(0);
      expect(await prisma.orderEvent.count({ where: { repairOrderId: orderId } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "order_events";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  });
});
