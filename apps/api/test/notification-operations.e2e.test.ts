import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  MembershipRole,
  MembershipStatus,
  NotificationChannel,
  NotificationStatus,
  OutboxStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { RateLimiterService } from "../src/common/auth/rate-limiter.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";

interface Actor {
  userId: string;
  shopId: string;
  token: string;
}

interface EventOptions {
  eventType?: string;
  status?: OutboxStatus;
  attempts?: number;
  lockVersion?: number;
  createdAt?: Date;
  channels?: Array<{
    channel: NotificationChannel;
    status: NotificationStatus;
    attempts?: number;
    lastErrorCode?: string | null;
    providerMessageId?: string | null;
  }>;
}

describe("owner notification operations API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rateLimiter: RateLimiterService;
  const shopIds: string[] = [];
  const userIds: string[] = [];

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
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationDelivery.deleteMany({
      where: { outboxEvent: { shopId: { in: shopIds } } },
    });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.auditLog.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.outboxEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  async function registerActor(
    label: string,
    role: MembershipRole = MembershipRole.OWNER,
    status: MembershipStatus = MembershipStatus.ACTIVE,
  ): Promise<Actor> {
    const suffix = randomUUID().slice(0, 8);
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/register-owner")
      .send({
        email: `rf053-${label}-${suffix}@example.com`,
        password: "correct horse battery staple",
        displayName: `${label} ${suffix}`,
        shopName: `RF053 ${label} ${suffix}`,
        branchName: "Main",
      })
      .expect(201);
    const user = response.body.data.user as { id: string; memberships: Array<{ shopId: string }> };
    const actor = {
      userId: user.id,
      shopId: user.memberships[0]!.shopId,
      token: response.body.data.accessToken as string,
    };
    shopIds.push(actor.shopId);
    userIds.push(actor.userId);
    if (role !== MembershipRole.OWNER || status !== MembershipStatus.ACTIVE) {
      await prisma.shopMembership.update({
        where: { shopId_userId: { shopId: actor.shopId, userId: actor.userId } },
        data: { role, status },
      });
    }
    return actor;
  }

  function ownerRequest(actor: Actor) {
    return {
      list: () =>
        request(app.getHttpServer())
          .get("/api/v1/operations/notifications")
          .set("Authorization", `Bearer ${actor.token}`)
          .set("X-Shop-Id", actor.shopId),
      detail: (eventId: string) =>
        request(app.getHttpServer())
          .get(`/api/v1/operations/notifications/${eventId}`)
          .set("Authorization", `Bearer ${actor.token}`)
          .set("X-Shop-Id", actor.shopId),
      retry: (eventId: string, expectedLockVersion: number, key = `rf053-${randomUUID()}`) =>
        request(app.getHttpServer())
          .post(`/api/v1/operations/notifications/${eventId}/retry`)
          .set("Authorization", `Bearer ${actor.token}`)
          .set("X-Shop-Id", actor.shopId)
          .set("Idempotency-Key", key)
          .send({ expectedLockVersion }),
    };
  }

  async function createEvent(actor: Actor, options: EventOptions = {}) {
    return prisma.outboxEvent.create({
      data: {
        shopId: actor.shopId,
        eventType: options.eventType ?? "QUOTE_SENT",
        aggregateType: "QUOTE",
        aggregateId: randomUUID(),
        payload: {
          rawToken: "rf053-raw-token-must-never-leak",
          destination: "secret-recipient@example.com",
          providerBody: "provider-body-must-never-leak",
        },
        status: options.status ?? OutboxStatus.FAILED,
        attempts: options.attempts ?? 2,
        lockVersion: options.lockVersion ?? 0,
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
        lockedBy: "secret-worker-name",
        lastError: "PROVIDER_TIMEOUT",
        notifications: {
          create: (
            options.channels ?? [
              {
                channel: NotificationChannel.EMAIL,
                status: NotificationStatus.FAILED,
                attempts: 2,
                lastErrorCode: "PROVIDER_TIMEOUT",
              },
            ]
          ).map((delivery) => ({
            channel: delivery.channel,
            destinationHash: "destination-hash-must-never-leak",
            status: delivery.status,
            attempts: delivery.attempts ?? 0,
            lastErrorCode: delivery.lastErrorCode ?? null,
            providerMessageId: delivery.providerMessageId ?? null,
          })),
        },
      },
      include: { notifications: true },
    });
  }

  it("allows only active owners and hides other tenants", async () => {
    const owner = await registerActor("owner");
    const otherOwner = await registerActor("other-owner");
    const receptionist = await registerActor("receptionist", MembershipRole.RECEPTIONIST);
    const technician = await registerActor("technician", MembershipRole.TECHNICIAN);
    const inactive = await registerActor(
      "inactive",
      MembershipRole.OWNER,
      MembershipStatus.INACTIVE,
    );
    const event = await createEvent(otherOwner);

    await ownerRequest(owner).list().expect(200);
    await ownerRequest(receptionist).list().expect(403);
    await ownerRequest(technician).list().expect(403);
    await ownerRequest(inactive).list().expect(403);
    await ownerRequest(owner).detail(event.id).expect(404);
    await ownerRequest(owner).retry(event.id, event.lockVersion).expect(404);
  });

  it("lists and reads only allowlisted metadata without sensitive fields", async () => {
    const owner = await registerActor("redaction");
    const event = await createEvent(owner, {
      status: OutboxStatus.DEAD_LETTER,
      attempts: 5,
      channels: [
        {
          channel: NotificationChannel.EMAIL,
          status: NotificationStatus.FAILED,
          attempts: 5,
          lastErrorCode: "PROVIDER_BODY: recipient secret-recipient@example.com",
          providerMessageId: "provider-message-must-never-leak",
        },
      ],
    });

    const list = await ownerRequest(owner).list().expect(200);
    const detail = await ownerRequest(owner).detail(event.id).expect(200);
    expect(detail.body.data).toMatchObject({
      id: event.id,
      status: "DEAD_LETTER",
      lastErrorCode: "PROVIDER_TIMEOUT",
      deliveries: [{ lastErrorCode: "UNKNOWN_ERROR" }],
    });
    const serialized = JSON.stringify({ list: list.body, detail: detail.body });
    for (const forbidden of [
      "payload",
      "destinationHash",
      "destination-hash-must-never-leak",
      "secret-recipient@example.com",
      "rf053-raw-token-must-never-leak",
      "provider-body-must-never-leak",
      "provider-message-must-never-leak",
      "secret-worker-name",
      "providerMessageId",
      "lockedBy",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("supports status, event type, channel filters and a stable descending cursor", async () => {
    const owner = await registerActor("filters");
    const older = await createEvent(owner, {
      eventType: "RF053_CURSOR",
      status: OutboxStatus.FAILED,
      createdAt: new Date("2026-09-27T10:00:00.000Z"),
    });
    const newer = await createEvent(owner, {
      eventType: "RF053_CURSOR",
      status: OutboxStatus.DEAD_LETTER,
      createdAt: new Date("2026-09-27T11:00:00.000Z"),
      channels: [{ channel: NotificationChannel.SMS, status: NotificationStatus.FAILED }],
    });

    const first = await ownerRequest(owner)
      .list()
      .query({ eventType: "RF053_CURSOR", limit: 1 })
      .expect(200);
    expect(first.body.data.map((item: { id: string }) => item.id)).toEqual([newer.id]);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));

    const insertedAfterPageOne = await createEvent(owner, {
      eventType: "RF053_CURSOR",
      createdAt: new Date("2026-09-27T12:00:00.000Z"),
    });
    const second = await ownerRequest(owner)
      .list()
      .query({ eventType: "RF053_CURSOR", limit: 1, cursor: first.body.meta.nextCursor })
      .expect(200);
    expect(second.body.data.map((item: { id: string }) => item.id)).toEqual([older.id]);
    expect(second.body.data.map((item: { id: string }) => item.id)).not.toContain(
      insertedAfterPageOne.id,
    );

    const filtered = await ownerRequest(owner)
      .list()
      .query({ status: "DEAD_LETTER", eventType: "RF053_CURSOR", channel: "SMS" })
      .expect(200);
    expect(filtered.body.data.map((item: { id: string }) => item.id)).toEqual([newer.id]);
    await ownerRequest(owner).list().query({ status: "PENDING" }).expect(422);
    await ownerRequest(owner).list().query({ cursor: "not-a-cursor" }).expect(422);
  });

  it("retries transactionally, preserves sent deliveries, audits safely, and replays idempotently", async () => {
    const owner = await registerActor("retry");
    const event = await createEvent(owner, {
      status: OutboxStatus.DEAD_LETTER,
      attempts: 5,
      lockVersion: 7,
      channels: [
        {
          channel: NotificationChannel.EMAIL,
          status: NotificationStatus.FAILED,
          attempts: 5,
          lastErrorCode: "PROVIDER_TIMEOUT",
        },
        {
          channel: NotificationChannel.SMS,
          status: NotificationStatus.SENT,
          attempts: 1,
          providerMessageId: "stable-provider-message",
        },
      ],
    });
    const key = `rf053-retry-${randomUUID()}`;
    const first = await ownerRequest(owner).retry(event.id, 7, key).expect(200);
    const replay = await ownerRequest(owner).retry(event.id, 7, key).expect(200);
    expect(replay.body).toEqual(first.body);
    expect(first.body.data).toMatchObject({ status: "PENDING", attempts: 0, lockVersion: 8 });

    const persisted = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
      include: { notifications: { orderBy: { channel: "asc" } } },
    });
    expect(persisted).toMatchObject({
      status: OutboxStatus.PENDING,
      attempts: 0,
      lockVersion: 8,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      completedAt: null,
    });
    expect(persisted.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: NotificationChannel.EMAIL,
          status: NotificationStatus.PENDING,
          attempts: 5,
          lastErrorCode: null,
        }),
        expect.objectContaining({
          channel: NotificationChannel.SMS,
          status: NotificationStatus.SENT,
          attempts: 1,
          providerMessageId: "stable-provider-message",
        }),
      ]),
    );
    const audits = await prisma.auditLog.findMany({
      where: { shopId: owner.shopId, entityId: event.id, action: "NOTIFICATION_RETRY_REQUESTED" },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toMatch(
      /destination|raw-token|recipient@example|provider-message|providerBody|payload/iu,
    );
    await ownerRequest(owner)
      .retry(event.id, 8, key)
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      });
  });

  it("allows only one concurrent retry and rejects a stale worker race", async () => {
    const owner = await registerActor("concurrency");
    const event = await createEvent(owner, { lockVersion: 3 });
    const results = await Promise.all([
      ownerRequest(owner).retry(event.id, 3, `rf053-race-a-${randomUUID()}`),
      ownerRequest(owner).retry(event.id, 3, `rf053-race-b-${randomUUID()}`),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)?.body.error.code).toBe(
      "CONCURRENT_UPDATE",
    );
    expect(
      await prisma.auditLog.count({
        where: { shopId: owner.shopId, entityId: event.id, action: "NOTIFICATION_RETRY_REQUESTED" },
      }),
    ).toBe(1);

    const workerRace = await createEvent(owner, { lockVersion: 4 });
    await prisma.outboxEvent.update({
      where: { id: workerRace.id },
      data: {
        status: OutboxStatus.PROCESSING,
        lockedAt: new Date(),
        lockedBy: "worker-race",
        lockVersion: { increment: 1 },
      },
    });
    await ownerRequest(owner)
      .retry(workerRace.id, 4)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("CONCURRENT_UPDATE"));
  });
});
