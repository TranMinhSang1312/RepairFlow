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

describe("final-audit stabilization APIs", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let shopA: string;
  let shopB: string;
  let ownerId: string;
  let receptionistId: string;
  let ownerToken: string;
  let receptionistToken: string;
  let customerId: string;
  let deviceId: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);
    const [a, b] = await Promise.all([
      prisma.shop.create({
        data: { name: `Stabilization A ${suffix}`, slug: `stabilization-a-${suffix}` },
      }),
      prisma.shop.create({
        data: { name: `Stabilization B ${suffix}`, slug: `stabilization-b-${suffix}` },
      }),
    ]);
    shopA = a.id;
    shopB = b.id;
    await prisma.branch.createMany({
      data: [
        { shopId: shopA, name: "Main" },
        { shopId: shopB, name: "Main" },
      ],
    });
    const [owner, receptionist] = await Promise.all([
      prisma.user.create({
        data: {
          email: `stabilization-owner-${suffix}@example.com`,
          passwordHash: "test-only",
          displayName: "Stabilization Owner",
        },
      }),
      prisma.user.create({
        data: {
          email: `stabilization-receptionist-${suffix}@example.com`,
          passwordHash: "test-only",
          displayName: "Stabilization Receptionist",
        },
      }),
    ]);
    ownerId = owner.id;
    receptionistId = receptionist.id;
    await prisma.shopMembership.createMany({
      data: [
        {
          shopId: shopA,
          userId: ownerId,
          role: MembershipRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
        {
          shopId: shopA,
          userId: receptionistId,
          role: MembershipRole.RECEPTIONIST,
          status: MembershipStatus.ACTIVE,
        },
        {
          shopId: shopB,
          userId: ownerId,
          role: MembershipRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
      ],
    });
    ownerToken = tokenService.createAccessToken(ownerId).token;
    receptionistToken = tokenService.createAccessToken(receptionistId).token;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { shopId: { in: [shopA, shopB] } } });
    await prisma.device.deleteMany({ where: { shopId: { in: [shopA, shopB] } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: [shopA, shopB] } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: [shopA, shopB] } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: [shopA, shopB] } } });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA, shopB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, receptionistId] } } });
    await app.close();
  });

  function staff(
    method: "get" | "post" | "patch" | "delete",
    path: string,
    token = ownerToken,
    shopId = shopA,
  ) {
    return request(app.getHttpServer())
      [method](path)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", shopId);
  }

  it("enforces owner-only settings and optimistic branch updates", async () => {
    await staff("get", "/api/v1/settings/shop", receptionistToken).expect(403);
    const initial = await staff("get", "/api/v1/settings/shop").expect(200);
    expect(initial.body.data.lockVersion).toBe(0);
    const updated = await staff("patch", "/api/v1/settings/shop")
      .send({ expectedLockVersion: 0, timezone: "Asia/Tokyo" })
      .expect(200);
    expect(updated.body.data.timezone).toBe("Asia/Tokyo");
    await staff("patch", "/api/v1/settings/shop")
      .send({ expectedLockVersion: 0, timezone: "UTC" })
      .expect(409);
    const branch = await staff("post", "/api/v1/settings/shop/branches")
      .send({ name: "Branch 2" })
      .expect(201);
    await staff("patch", `/api/v1/settings/shop/branches/${branch.body.data.id}`)
      .send({ expectedLockVersion: branch.body.data.lockVersion, isActive: false })
      .expect(200);
  });

  it("updates and archives customer/device without crossing tenants, with safe audit output", async () => {
    const customer = await staff("post", "/api/v1/customers", receptionistToken)
      .set("Idempotency-Key", `stabilization-${suffix}`)
      .send({ name: "Audit Customer", phone: "0901234567" })
      .expect(201);
    customerId = customer.body.data.id;
    const device = await staff("post", `/api/v1/customers/${customerId}/devices`, receptionistToken)
      .send({ type: DeviceType.PHONE, brand: "A", model: "M", serial: "SECRET-SERIAL" })
      .expect(201);
    deviceId = device.body.data.id;
    await staff("patch", `/api/v1/customers/${customerId}`, receptionistToken)
      .send({ name: "Updated Customer" })
      .expect(200);
    await staff("patch", `/api/v1/customers/${customerId}/devices/${deviceId}`, receptionistToken)
      .send({ model: "M2" })
      .expect(200);
    await staff("get", `/api/v1/customers/${customerId}/devices`, ownerToken, shopB).expect(404);
    const audit = await staff("get", "/api/v1/operations/audit-logs?entityType=CUSTOMER").expect(
      200,
    );
    expect(
      audit.body.data.some((row: { action: string }) => row.action === "customer.updated"),
    ).toBe(true);
    expect(JSON.stringify(audit.body)).not.toContain("SECRET-SERIAL");
    await staff("delete", `/api/v1/customers/${customerId}`, receptionistToken).expect(200);
    await staff("get", "/api/v1/customers?query=Updated%20Customer")
      .expect(200)
      .then((response) => expect(response.body.data).toHaveLength(0));
  });
});
