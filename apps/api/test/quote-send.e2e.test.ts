import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  DeviceType,
  MembershipRole,
  MembershipStatus,
  NotificationStatus,
  OutboxStatus,
  QuoteItemKind,
  QuoteStatus,
  RepairOrderStatus,
  TokenScope,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { TokenService } from "../src/common/auth/token.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
} from "../src/modules/notifications/notification-provider.js";

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
  ownerToken: string;
  receptionistToken: string;
  technicianToken: string;
  userIds: string[];
}

describe("quote send API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let nextOrderNo = 1;

  async function startApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const instance = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(instance);
    await instance.init();
    return instance;
  }

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);

    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({
        data: {
          name: `Send A ${suffix}`,
          slug: `send-a-${suffix}`,
          defaultQuoteExpiryHours: 6,
        },
      }),
      prisma.shop.create({ data: { name: `Send B ${suffix}`, slug: `send-b-${suffix}` } }),
    ]);
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopA.id, name: "Send Main A" } }),
      prisma.branch.create({ data: { shopId: shopB.id, name: "Send Main B" } }),
    ]);
    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "Send Customer A",
          phoneRaw: "0900000071",
          phoneNormalized: "+84900000071",
          email: "customer-a@example.com",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "Send Customer B",
          phoneRaw: "0900000072",
          phoneNormalized: "+84900000072",
        },
      }),
    ]);
    const [deviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopA.id,
          customerId: customerA.id,
          type: DeviceType.PHONE,
          brand: "Send",
          model: "A",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopB.id,
          customerId: customerB.id,
          type: DeviceType.LAPTOP,
          brand: "Send",
          model: "B",
        },
      }),
    ]);

    const userSpecs = [
      ["Send Owner A", MembershipRole.OWNER, shopA.id],
      ["Send Receptionist A", MembershipRole.RECEPTIONIST, shopA.id],
      ["Send Technician A", MembershipRole.TECHNICIAN, shopA.id],
      ["Send Owner B", MembershipRole.OWNER, shopB.id],
    ] as const;
    const users = await Promise.all(
      userSpecs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf036-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    await prisma.shopMembership.createMany({
      data: userSpecs.map(([, role, shopId], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status: MembershipStatus.ACTIVE,
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
      ownerBId: users[3]!.id,
      ownerToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      userIds: users.map(({ id }) => id),
    };
  });

  afterAll(async () => {
    if (!fixture) {
      await app.close();
      return;
    }
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.notificationDelivery.deleteMany({
      where: { outboxEvent: { shopId: { in: shopIds } } },
    });
    await prisma.outboxEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.publicAccessToken.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteItem.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteVersion.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shopIds } } });
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
    customerSnapshot?: Record<string, unknown>;
  }): Promise<string> {
    const isShopA = options?.shop !== "B";
    const orderNo = nextOrderNo++;
    const order = await prisma.repairOrder.create({
      data: {
        shopId: isShopA ? fixture.shopAId : fixture.shopBId,
        branchId: isShopA ? fixture.branchAId : fixture.branchBId,
        customerId: isShopA ? fixture.customerAId : fixture.customerBId,
        deviceId: isShopA ? fixture.deviceAId : fixture.deviceBId,
        orderNo,
        code: `SEND-${isShopA ? "A" : "B"}-${orderNo}`,
        status: options?.status ?? RepairOrderStatus.DIAGNOSING,
        reportedProblem: "Send test problem",
        intakeCondition: "Used condition",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: (options?.customerSnapshot ?? {
          name: "Snapshot customer",
          phone: "+84900000071",
          email: "snapshot@example.com",
        }) as Prisma.InputJsonValue,
        deviceSnapshot: { type: DeviceType.PHONE, brand: "Send", model: "Snapshot" },
        createdByUserId: isShopA ? fixture.ownerAId : fixture.ownerBId,
      },
    });
    return order.id;
  }

  async function createDraft(
    orderId: string,
    options?: {
      shop?: "A" | "B";
      versionNo?: number;
      expiresAt?: Date | null;
      withItems?: boolean;
      subtotal?: bigint;
    },
  ) {
    const isShopA = options?.shop !== "B";
    const subtotal = options?.subtotal ?? 250_000n;
    return prisma.quoteVersion.create({
      data: {
        shopId: isShopA ? fixture.shopAId : fixture.shopBId,
        repairOrderId: orderId,
        versionNo: options?.versionNo ?? 1,
        subtotal,
        total: subtotal,
        ...(options && "expiresAt" in options ? { expiresAt: options.expiresAt } : {}),
        createdByUserId: isShopA ? fixture.ownerAId : fixture.ownerBId,
        ...(options?.withItems === false
          ? {}
          : {
              items: {
                create: {
                  kind: QuoteItemKind.SERVICE,
                  description: "Screen replacement",
                  quantity: 1,
                  unitPrice: 250_000n,
                  lineTotal: 250_000n,
                },
              },
            }),
      },
    });
  }

  function sendRequest(
    quoteVersionId: string,
    channel = "COPY_LINK",
    options?: {
      token?: string;
      shopId?: string;
      key?: string;
      server?: Parameters<typeof request>[0];
    },
  ) {
    return request(options?.server ?? app.getHttpServer())
      .post(`/api/v1/quotes/${quoteVersionId}/send`)
      .set("Authorization", `Bearer ${options?.token ?? fixture.ownerToken}`)
      .set("X-Shop-Id", options?.shopId ?? fixture.shopAId)
      .set("Idempotency-Key", options?.key ?? `rf036-${randomUUID()}`)
      .send({ channel });
  }

  it("atomically sends a quote, transitions its order, and persists no raw token", async () => {
    const orderId = await createOrder();
    const quote = await createDraft(orderId);
    const capturedLogs: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      capturedLogs.push(String(chunk));
      return true;
    });
    let response: Awaited<ReturnType<typeof sendRequest>>;
    try {
      response = await sendRequest(quote.id).expect(200);
    } finally {
      writeSpy.mockRestore();
    }

    expect(response.body.data.quote).toMatchObject({
      id: quote.id,
      status: QuoteStatus.SENT,
      subtotal: 250_000,
      total: 250_000,
    });
    const publicUrl = new URL(response.body.data.publicUrl as string);
    const rawToken = publicUrl.pathname.split("/").at(-1)!;
    expect(rawToken.length).toBeGreaterThanOrEqual(43);
    expect(capturedLogs.join("\n")).not.toContain(rawToken);

    const [persistedQuote, order, tokens, events, outbox, idempotency] = await Promise.all([
      prisma.quoteVersion.findUniqueOrThrow({ where: { id: quote.id } }),
      prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.publicAccessToken.findMany({ where: { quoteVersionId: quote.id } }),
      prisma.orderEvent.findMany({ where: { repairOrderId: orderId } }),
      prisma.outboxEvent.findMany({
        where: { aggregateId: quote.id },
        include: { notifications: true },
      }),
      prisma.idempotencyRecord.findMany({
        where: { shopId: fixture.shopAId, scope: "quotes.send" },
      }),
    ]);
    expect(persistedQuote.status).toBe(QuoteStatus.SENT);
    expect(persistedQuote.sentAt).not.toBeNull();
    expect(persistedQuote.expiresAt!.getTime() - persistedQuote.sentAt!.getTime()).toBe(
      6 * 60 * 60 * 1000,
    );
    expect(order).toMatchObject({ status: RepairOrderStatus.AWAITING_APPROVAL, lockVersion: 1 });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ scope: TokenScope.DECIDE_QUOTE, revokedAt: null });
    expect(tokens[0]!.tokenHash).toBe(createHash("sha256").update(rawToken).digest("hex"));
    expect(idempotency[0]!.expiresAt).toEqual(tokens[0]!.expiresAt);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ status: OutboxStatus.PENDING, attempts: 0 });
    expect(outbox[0]!.payload).toMatchObject({ templateKey: "QUOTE_SENT_V1" });
    expect(outbox[0]!.notifications).toHaveLength(0);
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining(["ORDER_STATUS_CHANGED", "QUOTE_SENT"]),
    );

    const persistedData = JSON.stringify({ tokens, events, outbox, idempotency });
    expect(persistedData).not.toContain(rawToken);
    expect(persistedData).not.toContain(response.body.data.publicUrl);
    expect(JSON.stringify(idempotency[0]!.responseBody)).not.toContain("publicUrl");
  });

  it("enforces role, tenant, state, item, expiry, and destination boundaries", async () => {
    const roleOrder = await createOrder();
    const roleQuote = await createDraft(roleOrder);
    const denied = await sendRequest(roleQuote.id, "COPY_LINK", {
      token: fixture.technicianToken,
    }).expect(403);
    expect(denied.body.error.code).toBe("PERMISSION_DENIED");

    const foreignOrder = await createOrder({ shop: "B" });
    const foreignQuote = await createDraft(foreignOrder, { shop: "B" });
    const foreign = await sendRequest(foreignQuote.id).expect(404);
    expect(foreign.body.error.code).toBe("RESOURCE_NOT_FOUND");

    const receivedOrder = await createOrder({ status: RepairOrderStatus.RECEIVED });
    const receivedQuote = await createDraft(receivedOrder);
    expect((await sendRequest(receivedQuote.id).expect(409)).body.error.code).toBe(
      "REPAIR_ORDER_GUARD_FAILED",
    );

    const repairingOrder = await createOrder({ status: RepairOrderStatus.REPAIRING });
    const repairingQuote = await createDraft(repairingOrder);
    const missingApproval = await sendRequest(repairingQuote.id, "COPY_LINK", {
      token: fixture.receptionistToken,
    }).expect(409);
    expect(missingApproval.body.error.code).toBe("REPAIR_ORDER_GUARD_FAILED");
    expect(
      await prisma.repairOrder.findUniqueOrThrow({ where: { id: repairingOrder } }),
    ).toMatchObject({ status: RepairOrderStatus.REPAIRING, lockVersion: 0 });

    const awaitingOrder = await createOrder({ status: RepairOrderStatus.AWAITING_APPROVAL });
    const awaitingQuote = await createDraft(awaitingOrder);
    expect((await sendRequest(awaitingQuote.id).expect(409)).body.error.code).toBe(
      "REPAIR_ORDER_GUARD_FAILED",
    );

    const emptyOrder = await createOrder();
    const emptyQuote = await createDraft(emptyOrder, { withItems: false, subtotal: 0n });
    expect((await sendRequest(emptyQuote.id).expect(422)).body.error.code).toBe(
      "QUOTE_ITEMS_REQUIRED",
    );

    const expiredOrder = await createOrder();
    const expiredQuote = await createDraft(expiredOrder, {
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    expect((await sendRequest(expiredQuote.id).expect(422)).body.error.code).toBe(
      "VALIDATION_FAILED",
    );

    const destinationOrder = await createOrder({ customerSnapshot: { name: "No email" } });
    const destinationQuote = await createDraft(destinationOrder);
    expect((await sendRequest(destinationQuote.id, "EMAIL").expect(422)).body.error.code).toBe(
      "QUOTE_DESTINATION_REQUIRED",
    );

    const mismatchOrder = await createOrder();
    const mismatchQuote = await createDraft(mismatchOrder, { subtotal: 1n });
    const mismatch = await sendRequest(mismatchQuote.id).expect(422);
    expect(mismatch.body.error.details).toContainEqual(
      expect.objectContaining({ code: "AUTHORITATIVE_TOTAL_MISMATCH" }),
    );

    expect(
      await prisma.publicAccessToken.count({
        where: {
          quoteVersionId: {
            in: [
              roleQuote.id,
              foreignQuote.id,
              receivedQuote.id,
              awaitingQuote.id,
              emptyQuote.id,
              expiredQuote.id,
              destinationQuote.id,
              mismatchQuote.id,
            ],
          },
        },
      }),
    ).toBe(0);
  });

  it("replays the same URL across a fresh app and rejects payload mismatch", async () => {
    const orderId = await createOrder();
    const quote = await createDraft(orderId);
    const key = `rf036-replay-${randomUUID()}`;
    const first = await sendRequest(quote.id, "COPY_LINK", { key }).expect(200);

    const freshApp = await startApp();
    try {
      const replay = await sendRequest(quote.id, "COPY_LINK", {
        key,
        server: freshApp.getHttpServer(),
      }).expect(200);
      expect(replay.body).toEqual(first.body);
      const mismatch = await sendRequest(quote.id, "SMS", {
        key,
        server: freshApp.getHttpServer(),
      }).expect(409);
      expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    } finally {
      await freshApp.close();
    }

    expect(await prisma.publicAccessToken.count({ where: { quoteVersionId: quote.id } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: quote.id } })).toBe(1);
  });

  it("supersedes the previous sent quote and revokes its decision token", async () => {
    const orderId = await createOrder();
    const firstQuote = await createDraft(orderId, { versionNo: 1 });
    const secondQuote = await createDraft(orderId, { versionNo: 2 });
    const first = await sendRequest(firstQuote.id).expect(200);
    const firstRaw = new URL(first.body.data.publicUrl as string).pathname.split("/").at(-1)!;
    await sendRequest(secondQuote.id, "SMS", { token: fixture.receptionistToken }).expect(200);

    const [oldQuote, newQuote, oldToken, order, delivery] = await Promise.all([
      prisma.quoteVersion.findUniqueOrThrow({ where: { id: firstQuote.id } }),
      prisma.quoteVersion.findUniqueOrThrow({ where: { id: secondQuote.id } }),
      prisma.publicAccessToken.findFirstOrThrow({ where: { quoteVersionId: firstQuote.id } }),
      prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.notificationDelivery.findFirstOrThrow({
        where: { outboxEvent: { aggregateId: secondQuote.id } },
      }),
    ]);
    expect(oldQuote).toMatchObject({ status: QuoteStatus.SUPERSEDED, decidedAt: null });
    expect(newQuote.status).toBe(QuoteStatus.SENT);
    expect(oldToken.revokedAt).not.toBeNull();
    expect(oldToken.tokenHash).toBe(createHash("sha256").update(firstRaw).digest("hex"));
    expect(order).toMatchObject({ status: RepairOrderStatus.AWAITING_APPROVAL, lockVersion: 1 });
    expect(delivery).toMatchObject({ status: NotificationStatus.PENDING, attempts: 0 });
    expect(delivery.destinationHash).toHaveLength(64);
    expect(JSON.stringify(delivery)).not.toContain("+84900000071");
  });

  it("serializes concurrent sends so only one request commits", async () => {
    const orderId = await createOrder();
    const quote = await createDraft(orderId);
    const [first, second] = await Promise.all([
      sendRequest(quote.id),
      sendRequest(quote.id, "COPY_LINK", { token: fixture.receptionistToken }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(await prisma.publicAccessToken.count({ where: { quoteVersionId: quote.id } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: quote.id } })).toBe(1);
    expect(
      await prisma.orderEvent.count({ where: { repairOrderId: orderId, eventType: "QUOTE_SENT" } }),
    ).toBe(1);
  });

  it("rolls back every earlier write when a late outbox persistence boundary fails", async () => {
    const orderId = await createOrder();
    const quote = await createDraft(orderId);
    const key = `rf036-rollback-${randomUUID()}`;
    const functionName = `rf036_fail_outbox_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const triggerName = `${functionName}_trigger`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."aggregateId" = '${quote.id}' THEN
          RAISE EXCEPTION 'forced RF-036 outbox failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "outbox_events"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);

    try {
      await sendRequest(quote.id, "COPY_LINK", { key }).expect(500);
      expect(
        await prisma.quoteVersion.findUniqueOrThrow({ where: { id: quote.id } }),
      ).toMatchObject({
        status: QuoteStatus.DRAFT,
        sentAt: null,
      });
      expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
        status: RepairOrderStatus.DIAGNOSING,
        lockVersion: 0,
      });
      expect(await prisma.publicAccessToken.count({ where: { quoteVersionId: quote.id } })).toBe(0);
      expect(await prisma.orderEvent.count({ where: { repairOrderId: orderId } })).toBe(0);
      expect(await prisma.outboxEvent.count({ where: { aggregateId: quote.id } })).toBe(0);
      expect(
        await prisma.idempotencyRecord.count({
          where: { shopId: fixture.shopAId, scope: "quotes.send" },
        }),
      ).toBeGreaterThanOrEqual(0);
      const keyHash = createHash("sha256").update(key).digest("hex");
      expect(
        await prisma.idempotencyRecord.count({
          where: { shopId: fixture.shopAId, scope: "quotes.send", keyHash },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "outbox_events";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  });

  it("keeps provider work outside the transaction and exposes a deterministic fake boundary", async () => {
    const provider = app.get<NotificationProvider>(NOTIFICATION_PROVIDER);
    await expect(provider.deliver({ outboxEventId: "stable-outbox-id" })).resolves.toEqual({
      providerMessageId: "fake:stable-outbox-id",
    });

    const failingProvider = {
      deliver: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NOTIFICATION_PROVIDER)
      .useValue(failingProvider)
      .compile();
    const providerFailureApp = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(providerFailureApp);
    await providerFailureApp.init();
    try {
      const orderId = await createOrder();
      const quote = await createDraft(orderId);
      await sendRequest(quote.id, "EMAIL", {
        server: providerFailureApp.getHttpServer(),
      }).expect(200);
      expect(failingProvider.deliver).not.toHaveBeenCalled();
      const event = await prisma.outboxEvent.findFirstOrThrow({
        where: { aggregateId: quote.id },
        include: { notifications: true },
      });
      expect(event.status).toBe(OutboxStatus.PENDING);
      expect(event.notifications[0]).toMatchObject({ status: NotificationStatus.PENDING });
    } finally {
      await providerFailureApp.close();
    }
  });
});
