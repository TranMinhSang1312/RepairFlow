import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MembershipRole, MembershipStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { RateLimiterService } from "../src/common/auth/rate-limiter.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";

interface Actor {
  email: string;
  password: string;
  userId: string;
  shopId: string;
  token: string;
}

describe("staff membership management API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rateLimiter: RateLimiterService;
  const shopIds: string[] = [];
  const userIds = new Set<string>();

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
    await prisma.authSession.deleteMany({ where: { userId: { in: [...userIds] } } });
    await prisma.auditLog.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.staffInvitation.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    await app.close();
  });

  async function registerOwner(label = "owner"): Promise<Actor> {
    const suffix = randomUUID().slice(0, 8);
    const email = `rf039-${label}-${suffix}@example.com`;
    const password = "correct horse battery staple";
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register-owner")
      .send({
        email,
        password,
        displayName: `${label} ${suffix}`,
        shopName: `RF039 ${label} ${suffix}`,
        branchName: "Main",
      })
      .expect(201);
    const user = response.body.data.user as { id: string; memberships: Array<{ shopId: string }> };
    const actor = {
      email,
      password,
      userId: user.id,
      shopId: user.memberships[0]!.shopId,
      token: response.body.data.accessToken as string,
    };
    shopIds.push(actor.shopId);
    userIds.add(actor.userId);
    return actor;
  }

  async function invite(
    owner: Actor,
    email: string,
    role: "TECHNICIAN" | "RECEPTIONIST" = "TECHNICIAN",
  ) {
    const response = await request(app.getHttpServer())
      .post("/api/v1/staff-invitations")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", owner.shopId)
      .set("Idempotency-Key", `rf039-invite-${randomUUID()}`)
      .send({ email, role })
      .expect(201);
    const setupUrl = response.body.data.setupUrl as string;
    return {
      ...response.body.data,
      rawToken: decodeURIComponent(new URL(setupUrl).pathname.split("/").at(-1)!),
    } as {
      id: string;
      lockVersion: number;
      setupUrl: string;
      rawToken: string;
    };
  }

  async function acceptNew(rawToken: string, email: string): Promise<Actor> {
    const password = "new staff secure password";
    const response = await request(app.getHttpServer())
      .post("/public/v1/staff-invitation/accept")
      .set("X-RepairFlow-Invitation-Token", rawToken)
      .send({ displayName: "Invited Technician", password })
      .expect(201);
    const user = response.body.data.user as { id: string; memberships: Array<{ shopId: string }> };
    userIds.add(user.id);
    return {
      email,
      password,
      userId: user.id,
      shopId: user.memberships[0]!.shopId,
      token: response.body.data.accessToken as string,
    };
  }

  it("onboards a new technician atomically without persisting the raw token", async () => {
    const owner = await registerOwner();
    const email = `rf039-tech-${randomUUID().slice(0, 8)}@example.com`;
    const created = await invite(owner, email);

    const inspection = await request(app.getHttpServer())
      .get("/public/v1/staff-invitation")
      .set("X-RepairFlow-Invitation-Token", created.rawToken)
      .expect(200);
    expect(inspection.body.data).toMatchObject({
      role: "TECHNICIAN",
      acceptanceMode: "CREATE_ACCOUNT",
    });
    expect(inspection.body.data.maskedEmail).not.toBe(email);

    const technician = await acceptNew(created.rawToken, email);
    expect(technician.shopId).toBe(owner.shopId);
    const membership = await prisma.shopMembership.findUnique({
      where: { shopId_userId: { shopId: owner.shopId, userId: technician.userId } },
    });
    expect(membership).toMatchObject({
      role: MembershipRole.TECHNICIAN,
      status: MembershipStatus.ACTIVE,
    });
    expect(await prisma.authSession.count({ where: { userId: technician.userId } })).toBe(1);
    expect(await prisma.staffInvitation.findUnique({ where: { id: created.id } })).toMatchObject({
      status: "ACCEPTED",
      acceptedByUserId: technician.userId,
    });

    const persisted = JSON.stringify({
      invitation: await prisma.staffInvitation.findUnique({ where: { id: created.id } }),
      audits: await prisma.auditLog.findMany({ where: { shopId: owner.shopId } }),
      idempotency: await prisma.idempotencyRecord.findMany({ where: { shopId: owner.shopId } }),
    });
    expect(persisted).not.toContain(created.rawToken);
    expect(persisted).not.toContain(created.setupUrl);
    await request(app.getHttpServer())
      .post("/public/v1/staff-invitation/accept")
      .set("X-RepairFlow-Invitation-Token", created.rawToken)
      .send({ displayName: "Again", password: "another secure password" })
      .expect(409);
  });

  it("enforces owner/receptionist/technician permissions and immediate deactivation", async () => {
    const owner = await registerOwner("roles");
    const techEmail = `rf039-tech-${randomUUID().slice(0, 8)}@example.com`;
    const technician = await acceptNew((await invite(owner, techEmail)).rawToken, techEmail);
    await request(app.getHttpServer())
      .get("/api/v1/staff-memberships")
      .set("Authorization", `Bearer ${technician.token}`)
      .set("X-Shop-Id", owner.shopId)
      .expect(403);

    const receptionistEmail = `rf039-reception-${randomUUID().slice(0, 8)}@example.com`;
    const receptionist = await acceptNew(
      (await invite(owner, receptionistEmail, "RECEPTIONIST")).rawToken,
      receptionistEmail,
    );
    await request(app.getHttpServer())
      .get("/api/v1/staff-memberships")
      .set("Authorization", `Bearer ${receptionist.token}`)
      .set("X-Shop-Id", owner.shopId)
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/v1/staff-invitations")
      .set("Authorization", `Bearer ${receptionist.token}`)
      .set("X-Shop-Id", owner.shopId)
      .expect(403);

    const current = await prisma.shopMembership.findUniqueOrThrow({
      where: { shopId_userId: { shopId: owner.shopId, userId: technician.userId } },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/staff-memberships/${technician.userId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", owner.shopId)
      .set("Idempotency-Key", `rf039-disable-${randomUUID()}`)
      .send({ status: "INACTIVE", expectedLockVersion: current.lockVersion })
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/v1/repair-orders")
      .set("Authorization", `Bearer ${technician.token}`)
      .set("X-Shop-Id", owner.shopId)
      .expect(403);
    const technicians = await request(app.getHttpServer())
      .get("/api/v1/technicians")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", owner.shopId)
      .expect(200);
    expect(technicians.body.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: technician.userId })]),
    );
  });

  it("requires an existing invited user to sign in as the exact recipient", async () => {
    const destinationOwner = await registerOwner("destination");
    const existing = await registerOwner("existing");
    const created = await invite(destinationOwner, existing.email, "RECEPTIONIST");
    const inspect = await request(app.getHttpServer())
      .get("/public/v1/staff-invitation")
      .set("X-RepairFlow-Invitation-Token", created.rawToken)
      .expect(200);
    expect(inspect.body.data.acceptanceMode).toBe("SIGN_IN");
    await request(app.getHttpServer())
      .post("/public/v1/staff-invitation/accept")
      .set("X-RepairFlow-Invitation-Token", created.rawToken)
      .send({ displayName: "Wrong path", password: "some secure password" })
      .expect(409);

    const stranger = await registerOwner("stranger");
    await request(app.getHttpServer())
      .post("/api/v1/staff-invitations/accept")
      .set("Authorization", `Bearer ${stranger.token}`)
      .set("X-RepairFlow-Invitation-Token", created.rawToken)
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/v1/staff-invitations/accept")
      .set("Authorization", `Bearer ${existing.token}`)
      .set("X-RepairFlow-Invitation-Token", created.rawToken)
      .expect(200);
    expect(await prisma.shopMembership.count({ where: { userId: existing.userId } })).toBe(2);
  });

  it("hides cross-tenant identifiers, rejects payload mismatch, and preserves the last owner", async () => {
    const ownerA = await registerOwner("tenant-a");
    const ownerB = await registerOwner("tenant-b");
    const email = `rf039-cross-${randomUUID().slice(0, 8)}@example.com`;
    const key = `rf039-same-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post("/api/v1/staff-invitations")
      .set("Authorization", `Bearer ${ownerA.token}`)
      .set("X-Shop-Id", ownerA.shopId)
      .set("Idempotency-Key", key)
      .send({ email, role: "TECHNICIAN" })
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post("/api/v1/staff-invitations")
      .set("Authorization", `Bearer ${ownerA.token}`)
      .set("X-Shop-Id", ownerA.shopId)
      .set("Idempotency-Key", key)
      .send({ email, role: "TECHNICIAN" })
      .expect(201);
    expect(replay.body.data.setupUrl).toBe(first.body.data.setupUrl);
    await request(app.getHttpServer())
      .post("/api/v1/staff-invitations")
      .set("Authorization", `Bearer ${ownerA.token}`)
      .set("X-Shop-Id", ownerA.shopId)
      .set("Idempotency-Key", key)
      .send({ email, role: "RECEPTIONIST" })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/staff-invitations/${first.body.data.id}/revoke`)
      .set("Authorization", `Bearer ${ownerB.token}`)
      .set("X-Shop-Id", ownerB.shopId)
      .set("Idempotency-Key", `rf039-cross-${randomUUID()}`)
      .send({ expectedLockVersion: 0 })
      .expect(404);

    const ownerMembership = await prisma.shopMembership.findUniqueOrThrow({
      where: { shopId_userId: { shopId: ownerA.shopId, userId: ownerA.userId } },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/staff-memberships/${ownerA.userId}`)
      .set("Authorization", `Bearer ${ownerA.token}`)
      .set("X-Shop-Id", ownerA.shopId)
      .set("Idempotency-Key", `rf039-last-owner-${randomUUID()}`)
      .send({ status: "INACTIVE", expectedLockVersion: ownerMembership.lockVersion })
      .expect(409);
    expect(
      await prisma.shopMembership.findUnique({
        where: { shopId_userId: { shopId: ownerA.shopId, userId: ownerA.userId } },
      }),
    ).toMatchObject({ role: "OWNER", status: "ACTIVE" });
  });

  it("reissues, expires and revokes links while invalidating every old token", async () => {
    const owner = await registerOwner("lifecycle");
    const created = await invite(owner, `rf039-life-${randomUUID().slice(0, 8)}@example.com`);
    await prisma.staffInvitation.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await request(app.getHttpServer())
      .get("/public/v1/staff-invitation")
      .set("X-RepairFlow-Invitation-Token", created.rawToken)
      .expect(410);

    const reissuedResponse = await request(app.getHttpServer())
      .post(`/api/v1/staff-invitations/${created.id}/reissue`)
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", owner.shopId)
      .set("Idempotency-Key", `rf039-reissue-${randomUUID()}`)
      .send({ expectedLockVersion: created.lockVersion })
      .expect(200);
    const replacementUrl = reissuedResponse.body.data.setupUrl as string;
    const replacementToken = decodeURIComponent(
      new URL(replacementUrl).pathname.split("/").at(-1)!,
    );
    await request(app.getHttpServer())
      .get("/public/v1/staff-invitation")
      .set("X-RepairFlow-Invitation-Token", created.rawToken)
      .expect(404);
    await request(app.getHttpServer())
      .get("/public/v1/staff-invitation")
      .set("X-RepairFlow-Invitation-Token", replacementToken)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/staff-invitations/${reissuedResponse.body.data.id}/revoke`)
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", owner.shopId)
      .set("Idempotency-Key", `rf039-revoke-${randomUUID()}`)
      .send({ expectedLockVersion: reissuedResponse.body.data.lockVersion })
      .expect(200);
    await request(app.getHttpServer())
      .get("/public/v1/staff-invitation")
      .set("X-RepairFlow-Invitation-Token", replacementToken)
      .expect(404);
  });

  it("serializes concurrent attempts to remove the final active owners", async () => {
    const owner = await registerOwner("concurrency");
    const secondEmail = `rf039-owner-two-${randomUUID().slice(0, 8)}@example.com`;
    const second = await acceptNew((await invite(owner, secondEmail)).rawToken, secondEmail);
    const secondMembership = await prisma.shopMembership.findUniqueOrThrow({
      where: { shopId_userId: { shopId: owner.shopId, userId: second.userId } },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/staff-memberships/${second.userId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .set("X-Shop-Id", owner.shopId)
      .set("Idempotency-Key", `rf039-promote-${randomUUID()}`)
      .send({ role: "OWNER", expectedLockVersion: secondMembership.lockVersion })
      .expect(200);
    const [firstCurrent, secondCurrent] = await Promise.all([
      prisma.shopMembership.findUniqueOrThrow({
        where: { shopId_userId: { shopId: owner.shopId, userId: owner.userId } },
      }),
      prisma.shopMembership.findUniqueOrThrow({
        where: { shopId_userId: { shopId: owner.shopId, userId: second.userId } },
      }),
    ]);
    const calls = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/staff-memberships/${owner.userId}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .set("X-Shop-Id", owner.shopId)
        .set("Idempotency-Key", `rf039-concurrent-a-${randomUUID()}`)
        .send({ status: "INACTIVE", expectedLockVersion: firstCurrent.lockVersion }),
      request(app.getHttpServer())
        .patch(`/api/v1/staff-memberships/${second.userId}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .set("X-Shop-Id", owner.shopId)
        .set("Idempotency-Key", `rf039-concurrent-b-${randomUUID()}`)
        .send({ status: "INACTIVE", expectedLockVersion: secondCurrent.lockVersion }),
    ]);
    expect(calls.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.shopMembership.count({
        where: { shopId: owner.shopId, role: "OWNER", status: "ACTIVE" },
      }),
    ).toBe(1);
  });
});
