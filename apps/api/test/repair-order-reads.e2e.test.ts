import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  ActorType,
  DeviceType,
  MediaPurpose,
  MembershipRole,
  MembershipStatus,
  Priority,
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
  branchA2Id: string;
  customerAId: string;
  deviceAId: string;
  ownerToken: string;
  receptionistToken: string;
  technicianToken: string;
  technicianUserId: string;
  userIds: string[];
  featuredOrderId: string;
  unassignedOrderId: string;
  crossTenantOrderId: string;
}

describe("repair-order board and workspace API", () => {
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
      prisma.shop.create({ data: { name: `Board A ${suffix}`, slug: `board-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `Board B ${suffix}`, slug: `board-b-${suffix}` } }),
    ]);
    const [branchA, branchA2, branchB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopA.id, name: "Board Main" } }),
      prisma.branch.create({ data: { shopId: shopA.id, name: "Board Secondary" } }),
      prisma.branch.create({ data: { shopId: shopB.id, name: "Board Other" } }),
    ]);
    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "Current profile name",
          phoneRaw: "0999999999",
          phoneNormalized: "+84999999999",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "Other tenant",
          phoneRaw: "0988888888",
          phoneNormalized: "+84988888888",
        },
      }),
    ]);
    const [deviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopA.id,
          customerId: customerA.id,
          type: DeviceType.PHONE,
          brand: "Current Brand",
          model: "Current Model",
          serialNormalized: "CURRENT9999",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopB.id,
          customerId: customerB.id,
          type: DeviceType.TABLET,
          brand: "Other",
          model: "Tenant",
        },
      }),
    ]);
    const roles = [MembershipRole.OWNER, MembershipRole.RECEPTIONIST, MembershipRole.TECHNICIAN];
    const users = await Promise.all(
      roles.map((role) =>
        prisma.user.create({
          data: {
            email: `board-${role.toLowerCase()}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName: `Board ${role}`,
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

    const commonSnapshot = {
      customerSnapshot: {
        id: customerA.id,
        name: "Snapshot Customer",
        phone: "0901234567",
        email: "snapshot@example.com",
      },
      deviceSnapshot: {
        id: deviceA.id,
        type: DeviceType.PHONE,
        brand: "Snapshot Brand",
        model: "Snapshot Model",
        color: "Blue",
        serial: "SNAPSHOT1234",
        imei: "123456789012345",
      },
    };
    const featured = await prisma.repairOrder.create({
      data: {
        shopId: shopA.id,
        branchId: branchA.id,
        customerId: customerA.id,
        deviceId: deviceA.id,
        orderNo: 1,
        code: `BOARD-${suffix}-FEATURED`,
        status: RepairOrderStatus.DIAGNOSING,
        priority: Priority.URGENT,
        reportedProblem: "Unique charging symptom",
        intakeCondition: "Small scratch",
        consentAcknowledgedAt: new Date(),
        ...commonSnapshot,
        createdByUserId: users[0]!.id,
      },
    });
    await Promise.all([
      prisma.intakeAccessory.create({
        data: {
          shopId: shopA.id,
          repairOrderId: featured.id,
          name: "Charger",
          conditionNote: "Original",
        },
      }),
      prisma.assignment.create({
        data: {
          shopId: shopA.id,
          repairOrderId: featured.id,
          technicianUserId: users[2]!.id,
          assignedByUserId: users[0]!.id,
        },
      }),
      prisma.mediaAsset.create({
        data: {
          shopId: shopA.id,
          repairOrderId: featured.id,
          purpose: MediaPurpose.INTAKE,
          objectKey: `shops/${shopA.id}/read/${randomUUID()}.jpg`,
          originalName: "front.jpg",
          mimeType: "image/jpeg",
          byteSize: 100,
          uploadedByUserId: users[0]!.id,
          uploadedAt: new Date(),
        },
      }),
      prisma.orderEvent.create({
        data: {
          shopId: shopA.id,
          repairOrderId: featured.id,
          eventType: "ORDER_CREATED",
          toStatus: RepairOrderStatus.RECEIVED,
          actorType: ActorType.USER,
          actorUserId: users[0]!.id,
          publicPayload: { status: RepairOrderStatus.RECEIVED },
          privatePayload: { internal: "must-not-leak" },
          requestId: "private-request-id",
        },
      }),
    ]);
    const unassigned = await prisma.repairOrder.create({
      data: {
        shopId: shopA.id,
        branchId: branchA2.id,
        customerId: customerA.id,
        deviceId: deviceA.id,
        orderNo: 2,
        code: `BOARD-${suffix}-UNASSIGNED`,
        status: RepairOrderStatus.RECEIVED,
        priority: Priority.NORMAL,
        reportedProblem: "No assignment",
        intakeCondition: "Good",
        consentAcknowledgedAt: new Date(),
        ...commonSnapshot,
        createdByUserId: users[1]!.id,
      },
    });
    const crossTenant = await prisma.repairOrder.create({
      data: {
        shopId: shopB.id,
        branchId: branchB.id,
        customerId: customerB.id,
        deviceId: deviceB.id,
        orderNo: 1,
        code: `BOARD-${suffix}-OTHER`,
        reportedProblem: "Other tenant problem",
        intakeCondition: "Other tenant condition",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { id: customerB.id, name: "Other", phone: "0988888888" },
        deviceSnapshot: {
          id: deviceB.id,
          type: DeviceType.TABLET,
          brand: "Other",
          model: "Tenant",
        },
        createdByUserId: users[0]!.id,
      },
    });
    fixture = {
      shopAId: shopA.id,
      shopBId: shopB.id,
      branchAId: branchA.id,
      branchA2Id: branchA2.id,
      customerAId: customerA.id,
      deviceAId: deviceA.id,
      ownerToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      technicianUserId: users[2]!.id,
      userIds: users.map((user) => user.id),
      featuredOrderId: featured.id,
      unassignedOrderId: unassigned.id,
      crossTenantOrderId: crossTenant.id,
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.mediaAsset.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.intakeAccessory.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.assignment.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await app.close();
  });

  function get(path: string, token = fixture.ownerToken) {
    return request(app.getHttpServer())
      .get(path)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", fixture.shopAId);
  }

  it("lets owner and receptionist list the active shop and returns an empty filtered state", async () => {
    const owner = await get("/api/v1/repair-orders").expect(200);
    const receptionist = await get(
      `/api/v1/repair-orders?branchId=${fixture.branchA2Id}&status=RECEIVED`,
      fixture.receptionistToken,
    ).expect(200);
    const empty = await get("/api/v1/repair-orders?query=does-not-exist").expect(200);

    expect(owner.body.data.map((order: { id: string }) => order.id)).toEqual(
      expect.arrayContaining([fixture.featuredOrderId, fixture.unassignedOrderId]),
    );
    expect(owner.body.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: fixture.crossTenantOrderId })]),
    );
    expect(receptionist.body.data).toEqual([
      expect.objectContaining({
        id: fixture.unassignedOrderId,
        status: RepairOrderStatus.RECEIVED,
      }),
    ]);
    expect(empty.body).toEqual({ data: [], meta: { nextCursor: null } });
  });

  it("applies query, status, branch and technician filters together", async () => {
    const response = await get(
      `/api/v1/repair-orders?query=${encodeURIComponent("FEATURED")}` +
        `&status=DIAGNOSING&branchId=${fixture.branchAId}` +
        `&technicianUserId=${fixture.technicianUserId}`,
    ).expect(200);
    const repeatedStatuses = await get(
      "/api/v1/repair-orders?status=RECEIVED&status=DIAGNOSING",
    ).expect(200);
    const byCustomerPhone = await get("/api/v1/repair-orders?query=99999999").expect(200);
    const byDeviceModel = await get(
      `/api/v1/repair-orders?query=${encodeURIComponent("Current Model")}`,
    ).expect(200);

    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: fixture.featuredOrderId,
        assignedTechnicianUserId: fixture.technicianUserId,
      }),
    ]);
    expect(repeatedStatuses.body.data.length).toBeGreaterThanOrEqual(2);
    expect(byCustomerPhone.body.data.length).toBeGreaterThanOrEqual(2);
    expect(byDeviceModel.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("restricts technicians to actively assigned orders for list and detail", async () => {
    const list = await get("/api/v1/repair-orders", fixture.technicianToken).expect(200);
    const cannotBroaden = await get(
      `/api/v1/repair-orders?technicianUserId=${fixture.userIds[0]}`,
      fixture.technicianToken,
    ).expect(200);
    const assigned = await get(
      `/api/v1/repair-orders/${fixture.featuredOrderId}`,
      fixture.technicianToken,
    ).expect(200);
    const unassigned = await get(
      `/api/v1/repair-orders/${fixture.unassignedOrderId}`,
      fixture.technicianToken,
    ).expect(404);

    expect(list.body.data.map((order: { id: string }) => order.id)).toContain(
      fixture.featuredOrderId,
    );
    expect(list.body.data.map((order: { id: string }) => order.id)).not.toContain(
      fixture.unassignedOrderId,
    );
    expect(cannotBroaden.body.data.map((order: { id: string }) => order.id)).toEqual(
      list.body.data.map((order: { id: string }) => order.id),
    );
    expect(assigned.body.data.id).toBe(fixture.featuredOrderId);
    expect(unassigned.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("returns snapshot-based detail with safe intake evidence and timeline", async () => {
    const before = await prisma.repairOrder.findUniqueOrThrow({
      where: { id: fixture.featuredOrderId },
      select: { updatedAt: true },
    });
    const response = await get(`/api/v1/repair-orders/${fixture.featuredOrderId}`).expect(200);
    const after = await prisma.repairOrder.findUniqueOrThrow({
      where: { id: fixture.featuredOrderId },
      select: { updatedAt: true },
    });

    expect(response.body.data).toMatchObject({
      id: fixture.featuredOrderId,
      customer: {
        name: "Snapshot Customer",
        phone: "0901234567",
        email: "snapshot@example.com",
        notes: null,
      },
      device: {
        brand: "Snapshot Brand",
        model: "Snapshot Model",
        serialMasked: "••••1234",
        imeiMasked: "••••2345",
      },
      accessories: [expect.objectContaining({ name: "Charger", conditionNote: "Original" })],
      media: [
        expect.objectContaining({
          purpose: MediaPurpose.INTAKE,
          originalName: "front.jpg",
          mimeType: "image/jpeg",
          byteSize: 100,
        }),
      ],
      timeline: [
        expect.objectContaining({
          eventType: "ORDER_CREATED",
          publicPayload: { status: RepairOrderStatus.RECEIVED },
        }),
      ],
    });
    expect(response.body.data.media[0]).not.toHaveProperty("objectKey");
    expect(response.body.data.timeline[0]).not.toHaveProperty("privatePayload");
    expect(response.body.data.timeline[0]).not.toHaveProperty("requestId");
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("hides wrong-tenant and unknown detail identifiers", async () => {
    const crossTenant = await get(`/api/v1/repair-orders/${fixture.crossTenantOrderId}`).expect(
      404,
    );
    const unknown = await get(`/api/v1/repair-orders/${randomUUID()}`).expect(404);
    const malformed = await get("/api/v1/repair-orders/not-a-uuid").expect(404);

    expect(crossTenant.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(unknown.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(malformed.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("paginates deterministically without overlap when updatedAt values match", async () => {
    const marker = `PAGE-${randomUUID().slice(0, 8)}`;
    const updatedAt = new Date("2026-01-01T00:00:00.000Z");
    await prisma.repairOrder.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        shopId: fixture.shopAId,
        branchId: fixture.branchAId,
        customerId: fixture.customerAId,
        deviceId: fixture.deviceAId,
        orderNo: 100 + index,
        code: `${marker}-${index.toString().padStart(2, "0")}`,
        status: RepairOrderStatus.RECEIVED,
        priority: Priority.NORMAL,
        reportedProblem: marker,
        intakeCondition: "Pagination fixture",
        consentAcknowledgedAt: updatedAt,
        customerSnapshot: { name: "Page Customer", phone: "0900000000" },
        deviceSnapshot: { type: DeviceType.PHONE, brand: "Page", model: "Fixture" },
        createdByUserId: fixture.userIds[0]!,
        createdAt: updatedAt,
        updatedAt,
      })),
    });

    const first = await get(`/api/v1/repair-orders?query=${marker}`).expect(200);
    const second = await get(
      `/api/v1/repair-orders?query=${marker}&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`,
    ).expect(200);
    const firstIds = new Set(first.body.data.map((order: { id: string }) => order.id));

    expect(first.body.data).toHaveLength(25);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));
    expect(second.body.data).toHaveLength(1);
    expect(firstIds.has(second.body.data[0].id)).toBe(false);
    expect(second.body.meta.nextCursor).toBeNull();

    const invalid = await get("/api/v1/repair-orders?cursor=invalid").expect(422);
    expect(invalid.body.error.details).toEqual([
      expect.objectContaining({ field: "cursor", code: "INVALID_CURSOR" }),
    ]);
  });
});
