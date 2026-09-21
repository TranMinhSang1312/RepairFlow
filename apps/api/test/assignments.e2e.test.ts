import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DeviceType, MembershipRole, MembershipStatus } from "@prisma/client";
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
  ownerToken: string;
  receptionistToken: string;
  technicianToken: string;
  technicianOneId: string;
  technicianTwoId: string;
  inactiveTechnicianId: string;
  receptionistId: string;
  crossTenantTechnicianId: string;
  orderId: string;
  concurrentOrderId: string;
  rollbackOrderId: string;
  crossTenantOrderId: string;
  userIds: string[];
}

describe("technician discovery and assignment API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);

    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `Assignment A ${suffix}`, slug: `assign-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `Assignment B ${suffix}`, slug: `assign-b-${suffix}` } }),
    ]);
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopA.id, name: "Main A" } }),
      prisma.branch.create({ data: { shopId: shopB.id, name: "Main B" } }),
    ]);
    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "Assignment Customer A",
          phoneRaw: "0900000031",
          phoneNormalized: "+84900000031",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "Assignment Customer B",
          phoneRaw: "0900000032",
          phoneNormalized: "+84900000032",
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
      ["Owner A", MembershipRole.OWNER, shopA.id, MembershipStatus.ACTIVE],
      ["Receptionist A", MembershipRole.RECEPTIONIST, shopA.id, MembershipStatus.ACTIVE],
      ["Technician One", MembershipRole.TECHNICIAN, shopA.id, MembershipStatus.ACTIVE],
      ["Technician Two", MembershipRole.TECHNICIAN, shopA.id, MembershipStatus.ACTIVE],
      ["Inactive Technician", MembershipRole.TECHNICIAN, shopA.id, MembershipStatus.INACTIVE],
      ["Owner B", MembershipRole.OWNER, shopB.id, MembershipStatus.ACTIVE],
      ["Cross Technician", MembershipRole.TECHNICIAN, shopB.id, MembershipStatus.ACTIVE],
    ] as const;
    const users = await Promise.all(
      userSpecs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf031-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    await prisma.shopMembership.createMany({
      data: userSpecs.map(([, role, shopId, status], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status,
      })),
    });

    const snapshotA = {
      customerSnapshot: { name: customerA.name, phone: customerA.phoneRaw },
      deviceSnapshot: { type: deviceA.type, brand: deviceA.brand, model: deviceA.model },
    };
    const ordersA = await Promise.all(
      ["PRIMARY", "CONCURRENT", "ROLLBACK"].map((label, index) =>
        prisma.repairOrder.create({
          data: {
            shopId: shopA.id,
            branchId: branchA.id,
            customerId: customerA.id,
            deviceId: deviceA.id,
            orderNo: index + 1,
            code: `ASSIGN-${suffix}-${label}`,
            reportedProblem: label,
            intakeCondition: "Good",
            consentAcknowledgedAt: new Date(),
            ...snapshotA,
            createdByUserId: users[0]!.id,
          },
        }),
      ),
    );
    const crossTenantOrder = await prisma.repairOrder.create({
      data: {
        shopId: shopB.id,
        branchId: branchB.id,
        customerId: customerB.id,
        deviceId: deviceB.id,
        orderNo: 1,
        code: `ASSIGN-${suffix}-OTHER`,
        reportedProblem: "Other",
        intakeCondition: "Good",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: customerB.name, phone: customerB.phoneRaw },
        deviceSnapshot: { type: deviceB.type, brand: deviceB.brand, model: deviceB.model },
        createdByUserId: users[5]!.id,
      },
    });

    fixture = {
      shopAId: shopA.id,
      shopBId: shopB.id,
      ownerToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      technicianOneId: users[2]!.id,
      technicianTwoId: users[3]!.id,
      inactiveTechnicianId: users[4]!.id,
      receptionistId: users[1]!.id,
      crossTenantTechnicianId: users[6]!.id,
      orderId: ordersA[0]!.id,
      concurrentOrderId: ordersA[1]!.id,
      rollbackOrderId: ordersA[2]!.id,
      crossTenantOrderId: crossTenantOrder.id,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
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

  const staffRequest = (method: "get" | "post", path: string, token: string) =>
    request(app.getHttpServer())
      [method](path)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", fixture.shopAId);

  it("lists only active technicians and denies technician discovery", async () => {
    const response = await staffRequest("get", "/api/v1/technicians", fixture.ownerToken).expect(
      200,
    );
    expect(response.body.data).toEqual([
      { userId: fixture.technicianOneId, displayName: "Technician One" },
      { userId: fixture.technicianTwoId, displayName: "Technician Two" },
    ]);

    await staffRequest("get", "/api/v1/technicians", fixture.technicianToken).expect(403);
  });

  it("assigns, returns the same assignment on retry, and reassigns with history", async () => {
    const first = await staffRequest(
      "post",
      `/api/v1/repair-orders/${fixture.orderId}/assignments`,
      fixture.ownerToken,
    )
      .send({ technicianUserId: fixture.technicianOneId })
      .expect(201);
    expect(first.body.data).toMatchObject({
      repairOrderId: fixture.orderId,
      technicianUserId: fixture.technicianOneId,
      technicianDisplayName: "Technician One",
      assignedByUserId: expect.any(String),
      unassignedAt: null,
    });

    const repeated = await staffRequest(
      "post",
      `/api/v1/repair-orders/${fixture.orderId}/assignments`,
      fixture.receptionistToken,
    )
      .send({ technicianUserId: fixture.technicianOneId })
      .expect(201);
    expect(repeated.body.data.id).toBe(first.body.data.id);

    const replacement = await staffRequest(
      "post",
      `/api/v1/repair-orders/${fixture.orderId}/assignments`,
      fixture.receptionistToken,
    )
      .send({ technicianUserId: fixture.technicianTwoId })
      .expect(201);
    expect(replacement.body.data.technicianUserId).toBe(fixture.technicianTwoId);

    const history = await prisma.assignment.findMany({
      where: { shopId: fixture.shopAId, repairOrderId: fixture.orderId },
      orderBy: { assignedAt: "asc" },
    });
    expect(history).toHaveLength(2);
    expect(history[0]!.unassignedAt).not.toBeNull();
    expect(history[1]!.unassignedAt).toBeNull();
    expect(
      await prisma.orderEvent.count({
        where: {
          shopId: fixture.shopAId,
          repairOrderId: fixture.orderId,
          eventType: { in: ["TECHNICIAN_ASSIGNED", "TECHNICIAN_REASSIGNED"] },
        },
      }),
    ).toBe(2);

    const detail = await staffRequest(
      "get",
      `/api/v1/repair-orders/${fixture.orderId}`,
      fixture.ownerToken,
    ).expect(200);
    expect(detail.body.data.assignedTechnicianUserId).toBe(fixture.technicianTwoId);
    expect(detail.body.data.activeAssignment).toMatchObject({
      id: replacement.body.data.id,
      technicianDisplayName: "Technician Two",
    });

    const board = await staffRequest(
      "get",
      `/api/v1/repair-orders?technicianUserId=${fixture.technicianTwoId}`,
      fixture.ownerToken,
    ).expect(200);
    expect(board.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.orderId,
          assignedTechnicianUserId: fixture.technicianTwoId,
        }),
      ]),
    );
  });

  it.each([
    ["inactive technician", () => fixture.inactiveTechnicianId],
    ["wrong role", () => fixture.receptionistId],
    ["cross-tenant technician", () => fixture.crossTenantTechnicianId],
  ])("hides an invalid assignment target: %s", async (_label, technicianId) => {
    const response = await staffRequest(
      "post",
      `/api/v1/repair-orders/${fixture.orderId}/assignments`,
      fixture.ownerToken,
    )
      .send({ technicianUserId: technicianId() })
      .expect(404);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("denies technicians and hides a cross-tenant order", async () => {
    await staffRequest(
      "post",
      `/api/v1/repair-orders/${fixture.orderId}/assignments`,
      fixture.technicianToken,
    )
      .send({ technicianUserId: fixture.technicianOneId })
      .expect(403);

    const response = await staffRequest(
      "post",
      `/api/v1/repair-orders/${fixture.crossTenantOrderId}/assignments`,
      fixture.ownerToken,
    )
      .send({ technicianUserId: fixture.technicianOneId })
      .expect(404);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("serializes concurrent reassignment and leaves exactly one active row", async () => {
    const path = `/api/v1/repair-orders/${fixture.concurrentOrderId}/assignments`;
    const [first, second] = await Promise.all([
      staffRequest("post", path, fixture.ownerToken).send({
        technicianUserId: fixture.technicianOneId,
      }),
      staffRequest("post", path, fixture.ownerToken).send({
        technicianUserId: fixture.technicianTwoId,
      }),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(
      await prisma.assignment.count({
        where: { repairOrderId: fixture.concurrentOrderId, unassignedAt: null },
      }),
    ).toBe(1);
    expect(
      await prisma.assignment.count({ where: { repairOrderId: fixture.concurrentOrderId } }),
    ).toBe(2);
  });

  it("rolls back the assignment when timeline persistence fails", async () => {
    const functionName = `rf031_fail_event_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const triggerName = `${functionName}_trigger`;
    const orderId = fixture.rollbackOrderId;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."repairOrderId" = '${orderId}'::uuid THEN
          RAISE EXCEPTION 'forced RF-031 event failure';
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
      await staffRequest("post", `/api/v1/repair-orders/${orderId}/assignments`, fixture.ownerToken)
        .send({ technicianUserId: fixture.technicianOneId })
        .expect(500);
      expect(await prisma.assignment.count({ where: { repairOrderId: orderId } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "order_events";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  });
});
