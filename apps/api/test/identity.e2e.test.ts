import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { RateLimiterService } from "../src/common/auth/rate-limiter.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";

interface RegisterFixture {
  email: string;
  password: string;
  userId: string;
  shopId: string;
  accessToken: string;
  refreshCookie: string;
  refreshSetCookie: string;
}

function cookieLine(response: request.Response, name: string): string {
  const cookies = response.headers["set-cookie"] as string[] | undefined;
  const cookie = cookies?.find((value) => value.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`Missing ${name} cookie`);
  }

  return cookie;
}

function cookieValue(response: request.Response, name: string): string {
  return cookieLine(response, name).split(";", 1)[0]!;
}

describe("identity API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rateLimiter: RateLimiterService;
  const createdShopIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    rateLimiter = app.get(RateLimiterService);
  });

  beforeEach(() => rateLimiter.clear());

  afterAll(async () => {
    for (const shopId of createdShopIds) {
      const memberships = await prisma.shopMembership.findMany({ where: { shopId } });
      const userIds = memberships.map((membership) => membership.userId);
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.shopMembership.deleteMany({ where: { shopId } });
      await prisma.branch.deleteMany({ where: { shopId } });
      await prisma.shop.delete({ where: { id: shopId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app.close();
  });

  async function registerFixture(): Promise<RegisterFixture> {
    const suffix = randomUUID().slice(0, 8);
    const email = `rf010-${suffix}@example.com`;
    const password = "correct horse battery staple";
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register-owner")
      .send({
        email,
        password,
        displayName: "RepairFlow Owner",
        shopName: `RepairFlow Shop ${suffix}`,
        branchName: "Main branch",
      })
      .expect(201);
    const refreshCookie = cookieValue(response, "repairflow_refresh");
    const refreshSetCookie = cookieLine(response, "repairflow_refresh");
    const user = response.body.data.user as { id: string; memberships: Array<{ shopId: string }> };
    const shopId = user.memberships[0]!.shopId;
    createdShopIds.push(shopId);

    return {
      email,
      password,
      userId: user.id,
      shopId,
      accessToken: response.body.data.accessToken as string,
      refreshCookie,
      refreshSetCookie,
    };
  }

  it("registers an owner, shop, branch, membership and hashed session", async () => {
    const fixture = await registerFixture();
    const user = await prisma.user.findUnique({
      where: { id: fixture.userId },
      include: { memberships: { include: { shop: true } }, sessions: true },
    });

    expect(user?.passwordHash).not.toBe(fixture.password);
    expect(user?.passwordHash).toMatch(/^scrypt\$/);
    expect(user?.memberships[0]).toMatchObject({
      shopId: fixture.shopId,
      role: "OWNER",
      status: "ACTIVE",
    });
    expect(await prisma.branch.count({ where: { shopId: fixture.shopId } })).toBe(1);
    expect(user?.sessions).toHaveLength(1);
    expect(user?.sessions[0]?.refreshTokenHash).not.toContain(
      fixture.refreshCookie.split("=", 2)[1],
    );
    expect(fixture.accessToken).not.toContain(fixture.password);
    expect(fixture.refreshSetCookie).toContain("HttpOnly");
    expect(fixture.refreshSetCookie).toContain("SameSite=Lax");
    expect(fixture.refreshSetCookie).toContain("Path=/api/v1/auth");
  });

  it("returns contract validation details without echoing submitted secrets", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register-owner")
      .send({
        email: "not-an-email",
        password: "short",
        displayName: "Owner",
        shopName: "Shop",
        branchName: "Main",
        unexpected: "do not accept this",
      })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "One or more input fields are invalid.",
    });
    expect(response.body.error.requestId).toEqual(expect.any(String));
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "email", code: "INVALID_FIELD" }),
        expect.objectContaining({ field: "password", code: "INVALID_FIELD" }),
        expect.objectContaining({ field: "unexpected", code: "INVALID_FIELD" }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain("short");
  });

  it("uses REQUEST_MALFORMED for invalid JSON", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":')
      .expect(400);

    expect(response.body.error).toMatchObject({ code: "REQUEST_MALFORMED" });
  });

  it("rejects duplicate email atomically", async () => {
    const fixture = await registerFixture();
    const countsBefore = {
      users: await prisma.user.count(),
      shops: await prisma.shop.count(),
      branches: await prisma.branch.count(),
      memberships: await prisma.shopMembership.count(),
    };

    const duplicate = await request(app.getHttpServer())
      .post("/api/v1/auth/register-owner")
      .send({
        email: fixture.email.toUpperCase(),
        password: fixture.password,
        displayName: "Duplicate Owner",
        shopName: "Duplicate Shop",
        branchName: "Main",
      })
      .expect(409);

    expect(duplicate.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
    await expect(
      Promise.all([
        prisma.user.count(),
        prisma.shop.count(),
        prisma.branch.count(),
        prisma.shopMembership.count(),
      ]),
    ).resolves.toEqual([
      countsBefore.users,
      countsBefore.shops,
      countsBefore.branches,
      countsBefore.memberships,
    ]);
  });

  it("uses the same generic failure for wrong credentials and disabled users", async () => {
    const fixture = await registerFixture();
    const successfulLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: fixture.email.toUpperCase(), password: fixture.password })
      .expect(200);
    expect(successfulLogin.body.data.user.id).toBe(fixture.userId);
    expect(cookieValue(successfulLogin, "repairflow_refresh")).toMatch(/^repairflow_refresh=.+/);

    const wrongPassword = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: fixture.email, password: "wrong password" })
      .expect(401);

    const unknownUser = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: `unknown-${randomUUID()}@example.com`, password: fixture.password })
      .expect(401);

    await prisma.user.update({ where: { id: fixture.userId }, data: { status: "DISABLED" } });
    const disabledUser = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: fixture.email, password: fixture.password })
      .expect(401);

    expect(disabledUser.body.error).toMatchObject({
      code: wrongPassword.body.error.code,
      message: wrongPassword.body.error.message,
    });
    expect(unknownUser.body.error).toMatchObject({
      code: wrongPassword.body.error.code,
      message: wrongPassword.body.error.message,
    });
  });

  it("rotates refresh sessions and rejects reuse of the old cookie", async () => {
    const fixture = await registerFixture();
    const independentLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: fixture.email, password: fixture.password })
      .expect(200);
    const independentCookie = cookieValue(independentLogin, "repairflow_refresh");
    const rotated = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", fixture.refreshCookie)
      .expect(200);
    const rotatedCookie = cookieValue(rotated, "repairflow_refresh");

    const reused = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", fixture.refreshCookie)
      .expect(401);
    expect(reused.body.error.code).toBe("SESSION_EXPIRED");

    const successorRejected = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", rotatedCookie)
      .expect(401);
    expect(successorRejected.body.error.code).toBe("SESSION_EXPIRED");

    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", independentCookie)
      .expect(200);
  });

  it("returns the current user and revokes the refresh session on logout", async () => {
    const fixture = await registerFixture();
    await prisma.shop.update({
      where: { id: fixture.shopId },
      data: { intakePhotoMinimum: 2 },
    });
    await prisma.branch.create({
      data: { shopId: fixture.shopId, name: "Inactive branch", isActive: false },
    });
    const inactiveShop = await prisma.shop.create({
      data: { name: "Inactive membership shop", slug: `inactive-${randomUUID()}` },
    });
    createdShopIds.push(inactiveShop.id);
    await prisma.branch.create({
      data: { shopId: inactiveShop.id, name: "Hidden branch" },
    });
    await prisma.shopMembership.create({
      data: {
        shopId: inactiveShop.id,
        userId: fixture.userId,
        role: "RECEPTIONIST",
        status: "INACTIVE",
      },
    });
    const me = await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${fixture.accessToken}`)
      .expect(200);

    expect(me.body.data).toMatchObject({ id: fixture.userId, email: fixture.email });
    const activeMembership = me.body.data.memberships.find(
      (membership: { shopId: string }) => membership.shopId === fixture.shopId,
    );
    expect(activeMembership).toMatchObject({
      shopId: fixture.shopId,
      timezone: "Asia/Ho_Chi_Minh",
      intakePhotoMinimum: 2,
      branches: [{ id: expect.any(String), name: "Main branch" }],
    });
    expect(activeMembership.branches).toHaveLength(1);
    expect(
      me.body.data.memberships.find(
        (membership: { shopId: string }) => membership.shopId === inactiveShop.id,
      ),
    ).toMatchObject({ status: "INACTIVE", branches: [] });

    const logout = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${fixture.accessToken}`)
      .set("Cookie", fixture.refreshCookie)
      .expect(204);
    expect(cookieLine(logout, "repairflow_refresh")).toContain("Max-Age=0");

    const afterLogout = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", fixture.refreshCookie)
      .expect(401);
    expect(afterLogout.body.error.code).toBe("SESSION_EXPIRED");
  });
});
