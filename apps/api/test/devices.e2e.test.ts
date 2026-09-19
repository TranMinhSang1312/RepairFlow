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
  customerAId: string;
  customerBId: string;
  archivedCustomerAId: string;
  ownerToken: string;
  receptionistToken: string;
  technicianToken: string;
  userIds: string[];
}

describe("devices API", () => {
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
      prisma.shop.create({ data: { name: `Device A ${suffix}`, slug: `device-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `Device B ${suffix}`, slug: `device-b-${suffix}` } }),
    ]);
    const roles = [MembershipRole.OWNER, MembershipRole.RECEPTIONIST, MembershipRole.TECHNICIAN];
    const users = await Promise.all(
      roles.map((role) =>
        prisma.user.create({
          data: {
            email: `device-${role.toLowerCase()}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName: `Device ${role}`,
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
    const [customerA, customerB, archivedCustomerA] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "Device Customer A",
          phoneRaw: "0900000011",
          phoneNormalized: "+84900000011",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "Device Customer B",
          phoneRaw: "0900000012",
          phoneNormalized: "+84900000012",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "Archived Device Customer",
          phoneRaw: "0900000013",
          phoneNormalized: "+84900000013",
          archivedAt: new Date(),
        },
      }),
    ]);

    fixture = {
      shopAId: shopA.id,
      shopBId: shopB.id,
      customerAId: customerA.id,
      customerBId: customerB.id,
      archivedCustomerAId: archivedCustomerA.id,
      ownerToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.device.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await app.close();
  });

  function devicesRequest(method: "get" | "post", customerId: string, token = fixture.ownerToken) {
    return request(app.getHttpServer())
      [method](`/api/v1/customers/${customerId}/devices`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", fixture.shopAId);
  }

  it("creates and lists a device with protected identifiers", async () => {
    const created = await devicesRequest("post", fixture.customerAId, fixture.receptionistToken)
      .send({
        type: DeviceType.PHONE,
        brand: "Apple",
        model: "iPhone 15",
        color: "Black",
        serial: " ab-cd-123456 ",
        imei: "35 123456 789012 3",
        notes: "Screen damaged",
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      customerId: fixture.customerAId,
      type: DeviceType.PHONE,
      brand: "Apple",
      model: "iPhone 15",
      color: "Black",
      serialMasked: "••••3456",
      imeiMasked: "••••0123",
    });
    expect(JSON.stringify(created.body)).not.toContain("ABCD123456");
    expect(JSON.stringify(created.body)).not.toContain("351234567890123");

    const stored = await prisma.device.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(stored).toMatchObject({
      shopId: fixture.shopAId,
      serialNormalized: "ABCD123456",
      imeiNormalized: "351234567890123",
    });

    const listed = await devicesRequest("get", fixture.customerAId).expect(200);
    expect(listed.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.body.data.id })]),
    );
    expect(JSON.stringify(listed.body)).not.toContain("351234567890123");
  });

  it("allows repeated serial and IMEI values without a global unique constraint", async () => {
    const payload = {
      type: DeviceType.LAPTOP,
      brand: "Lenovo",
      model: "ThinkPad",
      serial: "DUPLICATE-001",
      imei: "350000000000001",
    };
    const first = await devicesRequest("post", fixture.customerAId).send(payload).expect(201);
    const second = await devicesRequest("post", fixture.customerAId).send(payload).expect(201);

    expect(first.body.data.id).not.toBe(second.body.data.id);
  });

  it("denies technicians and rejects credential fields", async () => {
    const denied = await devicesRequest("post", fixture.customerAId, fixture.technicianToken)
      .send({ type: DeviceType.PHONE, brand: "Samsung", model: "S25" })
      .expect(403);
    const credential = await devicesRequest("post", fixture.customerAId)
      .send({
        type: DeviceType.PHONE,
        brand: "Samsung",
        model: "S25",
        unlockPin: "1234",
      })
      .expect(422);
    const credentialInNotes = await devicesRequest("post", fixture.customerAId)
      .send({
        type: DeviceType.PHONE,
        brand: "Samsung",
        model: "S25",
        notes: "PIN: 1234",
      })
      .expect(422);

    expect(denied.body.error.code).toBe("PERMISSION_DENIED");
    expect(credential.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "unlockPin" })]),
    );
    expect(JSON.stringify(credential.body)).not.toContain("1234");
    expect(credentialInNotes.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "notes", code: "DEVICE_CREDENTIAL_NOT_ALLOWED" }),
      ]),
    );
    expect(JSON.stringify(credentialInNotes.body)).not.toContain("1234");
  });

  it("returns not-found for cross-tenant, archived and malformed customer ids", async () => {
    for (const customerId of [
      fixture.customerBId,
      fixture.archivedCustomerAId,
      "not-a-uuid",
      randomUUID(),
    ]) {
      const listed = await devicesRequest("get", customerId).expect(404);
      const created = await devicesRequest("post", customerId)
        .send({ type: DeviceType.TABLET, brand: "Apple", model: "iPad" })
        .expect(404);
      expect(listed.body.error).toMatchObject({
        code: "RESOURCE_NOT_FOUND",
        message: "Resource not found.",
      });
      expect(created.body.error.code).toBe(listed.body.error.code);
      expect(created.body.error.message).toBe(listed.body.error.message);
    }
  });

  it("filters archived devices from the list", async () => {
    const archived = await prisma.device.create({
      data: {
        shopId: fixture.shopAId,
        customerId: fixture.customerAId,
        type: DeviceType.OTHER,
        brand: "Archived",
        model: "Hidden",
        archivedAt: new Date(),
      },
    });
    const listed = await devicesRequest("get", fixture.customerAId).expect(200);

    expect(listed.body.data.map((device: { id: string }) => device.id)).not.toContain(archived.id);
  });
});
