import { Controller, Get, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MembershipRole, MembershipStatus, UserStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { ApiException } from "../src/common/api-exception.js";
import { AccessTokenGuard } from "../src/common/auth/access-token.guard.js";
import { TokenService } from "../src/common/auth/token.service.js";
import { Capability } from "../src/common/permissions/capability.js";
import { PermissionGuard } from "../src/common/permissions/permission.guard.js";
import { RequireCapabilities } from "../src/common/permissions/require-capabilities.decorator.js";
import { TenantGuard } from "../src/common/tenant/tenant.guard.js";
import { tenantWhere } from "../src/common/tenant/tenant-where.js";
import { CurrentTenant } from "../src/common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../src/common/tenant/tenant-context.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";

@Controller("test/tenant-boundary")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
class TenantBoundaryProbeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("context")
  @RequireCapabilities(Capability.REPAIR_ORDER_READ_ASSIGNED)
  context(@CurrentTenant() tenant: TenantContext): { data: TenantContext } {
    return { data: tenant };
  }

  @Post("intake")
  @RequireCapabilities(Capability.INTAKE_CREATE)
  createIntake(): { data: { accepted: true } } {
    return { data: { accepted: true } };
  }

  @Get("resources/:id")
  @RequireCapabilities(Capability.REPAIR_ORDER_READ_ASSIGNED)
  async resource(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
  ): Promise<{ data: { id: string } }> {
    const resource = await this.prisma.customer.findFirst({
      where: tenantWhere(tenant, { id }),
      select: { id: true },
    });
    if (!resource) {
      throw new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
    }

    return { data: resource };
  }

  @Patch("resources/:id")
  @RequireCapabilities(Capability.CUSTOMER_WRITE)
  async updateResource(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
  ): Promise<{ data: { updated: true } }> {
    const result = await this.prisma.customer.updateMany({
      where: tenantWhere(tenant, { id }),
      data: { notes: "tenant boundary probe" },
    });
    if (result.count !== 1) {
      throw new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
    }

    return { data: { updated: true } };
  }
}

interface Fixture {
  shopAId: string;
  shopBId: string;
  customerBId: string;
  ownerAToken: string;
  receptionistAToken: string;
  technicianAToken: string;
  inactiveAToken: string;
  disabledAToken: string;
  userIds: string[];
}

describe("tenant authorization boundary", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TenantBoundaryProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);

    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `Tenant A ${suffix}`, slug: `tenant-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `Tenant B ${suffix}`, slug: `tenant-b-${suffix}` } }),
    ]);
    const roles = [
      MembershipRole.OWNER,
      MembershipRole.RECEPTIONIST,
      MembershipRole.TECHNICIAN,
      MembershipRole.RECEPTIONIST,
      MembershipRole.OWNER,
      MembershipRole.OWNER,
    ];
    const users = await Promise.all(
      roles.map((role, index) =>
        prisma.user.create({
          data: {
            email: `rf011-${role.toLowerCase()}-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName: `${role} ${index}`,
            ...(index === 5 ? { status: UserStatus.DISABLED } : {}),
          },
        }),
      ),
    );

    await prisma.shopMembership.createMany({
      data: [
        {
          shopId: shopA.id,
          userId: users[0]!.id,
          role: roles[0]!,
          status: MembershipStatus.ACTIVE,
        },
        {
          shopId: shopA.id,
          userId: users[1]!.id,
          role: roles[1]!,
          status: MembershipStatus.ACTIVE,
        },
        {
          shopId: shopA.id,
          userId: users[2]!.id,
          role: roles[2]!,
          status: MembershipStatus.ACTIVE,
        },
        {
          shopId: shopA.id,
          userId: users[3]!.id,
          role: roles[3]!,
          status: MembershipStatus.INACTIVE,
        },
        {
          shopId: shopB.id,
          userId: users[4]!.id,
          role: roles[4]!,
          status: MembershipStatus.ACTIVE,
        },
        {
          shopId: shopA.id,
          userId: users[5]!.id,
          role: roles[5]!,
          status: MembershipStatus.ACTIVE,
        },
      ],
    });
    const customerB = await prisma.customer.create({
      data: {
        shopId: shopB.id,
        name: "Tenant B customer",
        phoneRaw: "0900000000",
        phoneNormalized: "+84900000000",
      },
    });

    fixture = {
      shopAId: shopA.id,
      shopBId: shopB.id,
      customerBId: customerB.id,
      ownerAToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistAToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianAToken: tokenService.createAccessToken(users[2]!.id).token,
      inactiveAToken: tokenService.createAccessToken(users[3]!.id).token,
      disabledAToken: tokenService.createAccessToken(users[5]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({
      where: { shopId: { in: [fixture.shopAId, fixture.shopBId] } },
    });
    await prisma.shopMembership.deleteMany({
      where: { shopId: { in: [fixture.shopAId, fixture.shopBId] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [fixture.shopAId, fixture.shopBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await app.close();
  });

  it("rejects missing authentication before tenant selection", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/test/tenant-boundary/context")
      .set("X-Shop-Id", fixture.shopAId)
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("requires a valid X-Shop-Id header", async () => {
    const missing = await request(app.getHttpServer())
      .get("/api/v1/test/tenant-boundary/context")
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .expect(422);
    const malformed = await request(app.getHttpServer())
      .get("/api/v1/test/tenant-boundary/context")
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .set("X-Shop-Id", "not-a-uuid")
      .expect(422);

    expect(missing.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: [expect.objectContaining({ field: "X-Shop-Id", code: "REQUIRED" })],
    });
    expect(malformed.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: [expect.objectContaining({ field: "X-Shop-Id", code: "INVALID_FORMAT" })],
    });
  });

  it("builds tenant context from an active membership", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/test/tenant-boundary/context")
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .set("X-Request-Id", "rf011-context-test")
      .expect(200);

    expect(response.body.data).toMatchObject({
      shopId: fixture.shopAId,
      role: MembershipRole.OWNER,
      requestId: "rf011-context-test",
    });
    expect(response.body.data.userId).toEqual(expect.any(String));
  });

  it("rejects an inactive membership", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/test/tenant-boundary/context")
      .set("Authorization", `Bearer ${fixture.inactiveAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(403);

    expect(response.body.error.code).toBe("MEMBERSHIP_INACTIVE");
  });

  it("rejects a disabled user even while an old access token is valid", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/test/tenant-boundary/context")
      .set("Authorization", `Bearer ${fixture.disabledAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("does not expose a shop without a membership", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/test/tenant-boundary/context")
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .set("X-Shop-Id", fixture.shopBId)
      .expect(404);

    expect(response.body.error.code).toBe("SHOP_NOT_FOUND");
  });

  it("allows receptionist intake and denies technician intake", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/test/tenant-boundary/intake")
      .set("Authorization", `Bearer ${fixture.receptionistAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(201);

    const denied = await request(app.getHttpServer())
      .post("/api/v1/test/tenant-boundary/intake")
      .set("Authorization", `Bearer ${fixture.technicianAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(403);

    expect(denied.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("makes a cross-tenant resource indistinguishable from a missing resource", async () => {
    const crossTenant = await request(app.getHttpServer())
      .get(`/api/v1/test/tenant-boundary/resources/${fixture.customerBId}`)
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(404);
    const missing = await request(app.getHttpServer())
      .get(`/api/v1/test/tenant-boundary/resources/${randomUUID()}`)
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(404);

    expect(crossTenant.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(crossTenant.body.error.code).toBe(missing.body.error.code);
    expect(crossTenant.body.error.message).toBe(missing.body.error.message);
  });

  it("cannot update a cross-tenant resource by guessing its id", async () => {
    const crossTenant = await request(app.getHttpServer())
      .patch(`/api/v1/test/tenant-boundary/resources/${fixture.customerBId}`)
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(404);
    const missing = await request(app.getHttpServer())
      .patch(`/api/v1/test/tenant-boundary/resources/${randomUUID()}`)
      .set("Authorization", `Bearer ${fixture.ownerAToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(404);

    expect(crossTenant.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(crossTenant.body.error.code).toBe(missing.body.error.code);
    expect(crossTenant.body.error.message).toBe(missing.body.error.message);
    await expect(
      prisma.customer.findUnique({ where: { id: fixture.customerBId }, select: { notes: true } }),
    ).resolves.toEqual({ notes: null });
  });
});
