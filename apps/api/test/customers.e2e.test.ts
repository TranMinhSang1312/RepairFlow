import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MembershipRole, MembershipStatus } from "@prisma/client";
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
  userIds: string[];
  suffix: string;
}

describe("customers API", () => {
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
      prisma.shop.create({ data: { name: `Customer A ${suffix}`, slug: `customer-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `Customer B ${suffix}`, slug: `customer-b-${suffix}` } }),
    ]);
    const roles = [MembershipRole.OWNER, MembershipRole.RECEPTIONIST, MembershipRole.TECHNICIAN];
    const users = await Promise.all(
      roles.map((role, index) =>
        prisma.user.create({
          data: {
            email: `customer-${role.toLowerCase()}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName: `Customer tester ${index}`,
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
      suffix,
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await app.close();
  });

  function staffRequest(method: "get" | "post", path: string, token = fixture.ownerToken) {
    return request(app.getHttpServer())
      [method](path)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", fixture.shopAId);
  }

  it("creates and searches a customer using normalized phone", async () => {
    const created = await staffRequest("post", "/api/v1/customers", fixture.receptionistToken)
      .set("Idempotency-Key", `customer-create-${randomUUID()}`)
      .send({
        name: "Nguyen Van An",
        phone: "090 123-4567",
        email: "AN@EXAMPLE.COM",
        notes: "Prefers phone calls",
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      name: "Nguyen Van An",
      phone: "090 123-4567",
      email: "an@example.com",
      notes: "Prefers phone calls",
    });
    expect(created.body.data).not.toHaveProperty("shopId");
    expect(created.body.data).not.toHaveProperty("phoneNormalized");

    const byPhone = await staffRequest("get", "/api/v1/customers?query=0901234567").expect(200);
    const byName = await staffRequest("get", "/api/v1/customers?query=nguyen%20van").expect(200);
    expect(byPhone.body.data.map((customer: { id: string }) => customer.id)).toContain(
      created.body.data.id,
    );
    expect(byName.body.data.map((customer: { id: string }) => customer.id)).toContain(
      created.body.data.id,
    );
  });

  it("replays the same idempotent request and rejects a changed payload", async () => {
    const key = `customer-retry-${randomUUID()}`;
    const payload = { name: "Retry Customer", phone: "0912345678" };
    const first = await staffRequest("post", "/api/v1/customers")
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);
    const replay = await staffRequest("post", "/api/v1/customers")
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);
    const conflict = await staffRequest("post", "/api/v1/customers")
      .set("Idempotency-Key", key)
      .send({ ...payload, name: "Changed Customer" })
      .expect(409);

    expect(replay.body).toEqual(first.body);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await prisma.customer.count({ where: { id: first.body.data.id } })).toBe(1);
  });

  it("denies technicians and validates both headers and body", async () => {
    const denied = await staffRequest("post", "/api/v1/customers", fixture.technicianToken)
      .set("Idempotency-Key", `customer-denied-${randomUUID()}`)
      .send({ name: "Denied", phone: "0901234567" })
      .expect(403);
    const missingKey = await staffRequest("post", "/api/v1/customers")
      .send({ name: "Missing key", phone: "0901234567" })
      .expect(422);
    const invalidBody = await staffRequest("post", "/api/v1/customers")
      .set("Idempotency-Key", `customer-invalid-${randomUUID()}`)
      .send({ name: "", phone: "123", unexpected: "blocked" })
      .expect(422);

    expect(denied.body.error.code).toBe("PERMISSION_DENIED");
    expect(missingKey.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "Idempotency-Key" })]),
    );
    expect(invalidBody.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "name" }),
        expect.objectContaining({ field: "phone" }),
        expect.objectContaining({ field: "unexpected" }),
      ]),
    );
  });

  it("does not return archived or cross-tenant customers", async () => {
    const marker = `isolated-${fixture.suffix}`;
    await Promise.all([
      prisma.customer.create({
        data: {
          shopId: fixture.shopBId,
          name: marker,
          phoneRaw: "0900000001",
          phoneNormalized: "+84900000001",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: fixture.shopAId,
          name: marker,
          phoneRaw: "0900000002",
          phoneNormalized: "+84900000002",
          archivedAt: new Date(),
        },
      }),
    ]);

    const response = await staffRequest(
      "get",
      `/api/v1/customers?query=${encodeURIComponent(marker)}`,
    ).expect(200);
    expect(response.body).toEqual({ data: [], meta: { nextCursor: null } });
  });

  it("returns stable non-overlapping cursor pages", async () => {
    const marker = `page-${fixture.suffix}`;
    await prisma.customer.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        shopId: fixture.shopAId,
        name: `${marker}-${index.toString().padStart(2, "0")}`,
        phoneRaw: `092000${index.toString().padStart(4, "0")}`,
        phoneNormalized: `+8492000${index.toString().padStart(4, "0")}`,
      })),
    });

    const first = await staffRequest(
      "get",
      `/api/v1/customers?query=${encodeURIComponent(marker)}`,
    ).expect(200);
    const second = await staffRequest(
      "get",
      `/api/v1/customers?query=${encodeURIComponent(marker)}&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`,
    ).expect(200);
    const firstIds = new Set(first.body.data.map((customer: { id: string }) => customer.id));

    expect(first.body.data).toHaveLength(25);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));
    expect(second.body.data).toHaveLength(1);
    expect(firstIds.has(second.body.data[0].id)).toBe(false);
    expect(second.body.meta.nextCursor).toBeNull();
  });
});
