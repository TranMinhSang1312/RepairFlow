import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  CompletionOutcome,
  DeviceType,
  MembershipRole,
  MembershipStatus,
  OutboxStatus,
  QuoteDecision,
  QuoteItemKind,
  QuoteStatus,
  RepairOrderStatus,
  TokenScope,
} from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { RateLimiterService } from "../src/common/auth/rate-limiter.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";
import { redactPublicTokenRequest, redactPublicTokenUrl } from "../src/logging.js";
import { PublicTokenService } from "../src/modules/public-access/public-token.service.js";

interface Fixture {
  shopId: string;
  branchId: string;
  customerId: string;
  deviceId: string;
  ownerId: string;
}

interface PublicCase {
  orderId: string;
  quoteId: string | null;
  itemIds: {
    required: string;
    groupA: string;
    groupB: string;
    independent: string;
  } | null;
  tokenId: string;
  rawToken: string;
}

describe("public quote read and decision API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenService: PublicTokenService;
  let rateLimiter: RateLimiterService;
  let fixture: Fixture;
  let nextOrderNo = 1;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    tokenService = app.get(PublicTokenService);
    rateLimiter = app.get(RateLimiterService);
    const suffix = randomUUID().slice(0, 8);

    const shop = await prisma.shop.create({
      data: {
        name: `Public Shop ${suffix}`,
        slug: `public-shop-${suffix}`,
        contactPhone: "028-5555-0101",
      },
    });
    const branch = await prisma.branch.create({ data: { shopId: shop.id, name: "Public Main" } });
    const customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        name: "Sensitive Customer Name",
        phoneRaw: "0900999888",
        phoneNormalized: "+84900999888",
        email: "sensitive-customer@example.com",
        notes: "PRIVATE CUSTOMER NOTES",
      },
    });
    const device = await prisma.device.create({
      data: {
        shopId: shop.id,
        customerId: customer.id,
        type: DeviceType.PHONE,
        brand: "PublicBrand",
        model: "PublicModel",
        serialNormalized: "SECRET-SERIAL",
        imeiNormalized: "SECRET-IMEI",
        notes: "PRIVATE DEVICE NOTES",
      },
    });
    const owner = await prisma.user.create({
      data: {
        email: `rf037-${suffix}@example.com`,
        passwordHash: "private-password-hash",
        displayName: "Private Staff Name",
      },
    });
    await prisma.shopMembership.create({
      data: {
        shopId: shop.id,
        userId: owner.id,
        role: MembershipRole.OWNER,
        status: MembershipStatus.ACTIVE,
      },
    });

    fixture = {
      shopId: shop.id,
      branchId: branch.id,
      customerId: customer.id,
      deviceId: device.id,
      ownerId: owner.id,
    };
  });

  afterAll(async () => {
    if (!fixture) {
      await app.close();
      return;
    }
    await prisma.notificationDelivery.deleteMany({
      where: { outboxEvent: { shopId: fixture.shopId } },
    });
    await prisma.outboxEvent.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.publicAccessToken.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.quoteApproval.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.quoteItem.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.quoteVersion.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.diagnosis.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.orderEvent.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.repairOrder.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.device.delete({ where: { id: fixture.deviceId } });
    await prisma.customer.delete({ where: { id: fixture.customerId } });
    await prisma.shopMembership.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.branch.delete({ where: { id: fixture.branchId } });
    await prisma.shop.delete({ where: { id: fixture.shopId } });
    await prisma.user.delete({ where: { id: fixture.ownerId } });
    await app.close();
  });

  async function createOrder(status: RepairOrderStatus = RepairOrderStatus.AWAITING_APPROVAL) {
    const orderNo = nextOrderNo++;
    return prisma.repairOrder.create({
      data: {
        shopId: fixture.shopId,
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        deviceId: fixture.deviceId,
        orderNo,
        code: `PUBLIC-${orderNo}`,
        status,
        reportedProblem: "PRIVATE REPORTED PROBLEM",
        intakeCondition: "PRIVATE INTAKE CONDITION",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: {
          name: "Snapshot Sensitive Name",
          phone: "0900111222",
          email: "snapshot-sensitive@example.com",
        },
        deviceSnapshot: {
          type: DeviceType.PHONE,
          brand: "Acme",
          model: "Phone X",
          serial: "SN-PRIVATE-123",
          imei: "IMEI-PRIVATE-456",
        },
        createdByUserId: fixture.ownerId,
        events: {
          create: [
            {
              eventType: "REPAIR_ORDER_RECEIVED",
              actorType: "USER",
              actorUserId: fixture.ownerId,
              publicPayload: { message: "The device was received safely." },
              privatePayload: { secret: "PRIVATE EVENT PAYLOAD" },
              requestId: "private-request-id",
            },
            {
              eventType: "PRIVATE_ONLY_EVENT",
              actorType: "USER",
              actorUserId: fixture.ownerId,
              privatePayload: { secret: "PRIVATE ONLY TIMELINE" },
            },
          ],
        },
      },
    });
  }

  async function createPublicCase(options?: {
    scope?: TokenScope;
    tokenExpiresAt?: Date;
    revokedAt?: Date | null;
    quoteStatus?: QuoteStatus;
    quoteExpiresAt?: Date;
    orderStatus?: RepairOrderStatus;
    bindQuoteToDifferentOrder?: boolean;
    decided?: boolean;
  }): Promise<PublicCase> {
    const order = await createOrder(options?.orderStatus);
    const scope = options?.scope ?? TokenScope.DECIDE_QUOTE;
    let quoteOrderId = order.id;
    if (options?.bindQuoteToDifferentOrder) {
      quoteOrderId = (await createOrder()).id;
    }

    let quoteId: string | null = null;
    let itemIds: PublicCase["itemIds"] = null;
    if (scope === TokenScope.DECIDE_QUOTE) {
      const quote = await prisma.quoteVersion.create({
        data: {
          shopId: fixture.shopId,
          repairOrderId: quoteOrderId,
          versionNo: 1,
          status: options?.quoteStatus ?? QuoteStatus.SENT,
          currency: "VND",
          subtotal: 220n,
          discount: 20n,
          total: 200n,
          customerNote: "Customer-safe quote note",
          expiresAt: options?.quoteExpiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
          sentAt: new Date(),
          decidedAt: options?.decided ? new Date() : null,
          createdByUserId: fixture.ownerId,
          items: {
            create: [
              {
                kind: QuoteItemKind.SERVICE,
                description: "Required service",
                quantity: 1,
                unitPrice: 100n,
                lineTotal: 100n,
                isOptional: false,
                sortOrder: 0,
              },
              {
                kind: QuoteItemKind.PART,
                description: "Grouped part A",
                quantity: 1,
                unitPrice: 30n,
                lineTotal: 30n,
                isOptional: true,
                approvalGroup: "bundle-a",
                sortOrder: 1,
              },
              {
                kind: QuoteItemKind.FEE,
                description: "Grouped fee B",
                quantity: 1,
                unitPrice: 40n,
                lineTotal: 40n,
                isOptional: true,
                approvalGroup: "bundle-a",
                sortOrder: 2,
              },
              {
                kind: QuoteItemKind.PART,
                description: "Independent option",
                quantity: 1,
                unitPrice: 50n,
                lineTotal: 50n,
                isOptional: true,
                sortOrder: 3,
              },
            ],
          },
        },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
      quoteId = quote.id;
      itemIds = {
        required: quote.items[0]!.id,
        groupA: quote.items[1]!.id,
        groupB: quote.items[2]!.id,
        independent: quote.items[3]!.id,
      };
      if (options?.decided) {
        await prisma.quoteApproval.create({
          data: {
            shopId: fixture.shopId,
            quoteVersionId: quote.id,
            decision: QuoteDecision.ACCEPTED,
            approvedItemSnapshot: [],
            approvedTotal: quote.total,
            idempotencyKeyHash: "already-decided",
          },
        });
      }
    }

    const rawToken = randomBytes(32).toString("base64url");
    const token = await prisma.publicAccessToken.create({
      data: {
        shopId: fixture.shopId,
        repairOrderId: order.id,
        quoteVersionId: quoteId,
        scope,
        tokenHash: tokenService.hash(rawToken),
        expiresAt: options?.tokenExpiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
        ...(options?.revokedAt !== undefined ? { revokedAt: options.revokedAt } : {}),
      },
    });
    return { orderId: order.id, quoteId, itemIds, tokenId: token.id, rawToken };
  }

  function readRequest(rawToken: string) {
    return request(app.getHttpServer()).get(`/public/v1/orders/${rawToken}`);
  }

  function decisionRequest(rawToken: string, key = `rf037-${randomUUID()}`) {
    return request(app.getHttpServer())
      .post(`/public/v1/quotes/${rawToken}/decision`)
      .set("Idempotency-Key", key)
      .set("User-Agent", "RF037 integration user agent")
      .set("X-Request-Id", `req-${randomUUID()}`);
  }

  it("returns an explicit public-safe allowlist without staff authentication", async () => {
    const testCase = await createPublicCase();
    const response = await readRequest(testCase.rawToken).expect(200);

    expect(response.body.data).toEqual({
      shopName: expect.stringContaining("Public Shop"),
      shopContact: "028-5555-0101",
      orderCode: expect.stringMatching(/^PUBLIC-/u),
      deviceLabel: "Acme Phone X",
      status: RepairOrderStatus.AWAITING_APPROVAL,
      completionOutcome: null,
      timeline: [
        {
          type: "REPAIR_ORDER_RECEIVED",
          message: "The device was received safely.",
          createdAt: expect.any(String),
        },
      ],
      quote: expect.objectContaining({
        id: testCase.quoteId,
        status: QuoteStatus.SENT,
        subtotal: 220,
        discount: 20,
        total: 200,
        customerNote: "Customer-safe quote note",
        items: expect.arrayContaining([
          expect.objectContaining({ description: "Required service", lineTotal: 100 }),
        ]),
      }),
    });
    expect(response.body.data.quote).not.toHaveProperty("createdByUserId");
    expect(response.body.data.quote).not.toHaveProperty("diagnosisId");

    const serialized = JSON.stringify(response.body);
    for (const sensitive of [
      testCase.rawToken,
      "Sensitive Customer Name",
      "sensitive-customer@example.com",
      "Snapshot Sensitive Name",
      "snapshot-sensitive@example.com",
      "PRIVATE REPORTED PROBLEM",
      "PRIVATE INTAKE CONDITION",
      "SN-PRIVATE-123",
      "IMEI-PRIVATE-456",
      "PRIVATE EVENT PAYLOAD",
      "PRIVATE ONLY TIMELINE",
      "Private Staff Name",
      fixture.ownerId,
      "private-request-id",
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
    expect(
      (await prisma.publicAccessToken.findUniqueOrThrow({ where: { id: testCase.tokenId } }))
        .lastUsedAt,
    ).not.toBeNull();
    await request(app.getHttpServer())
      .get(`/api/v1/public/v1/orders/${testCase.rawToken}`)
      .expect(404);
  });

  it("allows TRACK_ORDER to read without exposing a quote and rejects it for decisions", async () => {
    const testCase = await createPublicCase({ scope: TokenScope.TRACK_ORDER });
    const read = await readRequest(testCase.rawToken).expect(200);
    expect(read.body.data.quote).toBeNull();
    expect(
      (
        await decisionRequest(testCase.rawToken)
          .send({ decision: QuoteDecision.DECLINED })
          .expect(404)
      ).body.error.code,
    ).toBe("PUBLIC_LINK_INVALID");
  });

  it("rejects invalid, revoked, expired, superseded, quote-expired, and wrong-bound tokens", async () => {
    const invalidToken = randomBytes(32).toString("base64url");
    expect((await readRequest(invalidToken).expect(404)).body.error.code).toBe(
      "PUBLIC_LINK_INVALID",
    );
    expect(
      (await decisionRequest(invalidToken).send({ decision: QuoteDecision.DECLINED }).expect(404))
        .body.error.code,
    ).toBe("PUBLIC_LINK_INVALID");
    const revoked = await createPublicCase({ revokedAt: new Date() });
    expect((await readRequest(revoked.rawToken).expect(404)).body.error.code).toBe(
      "PUBLIC_LINK_INVALID",
    );
    expect(
      (
        await decisionRequest(revoked.rawToken)
          .send({ decision: QuoteDecision.DECLINED })
          .expect(404)
      ).body.error.code,
    ).toBe("PUBLIC_LINK_INVALID");
    const expired = await createPublicCase({ tokenExpiresAt: new Date(Date.now() - 1000) });
    expect((await readRequest(expired.rawToken).expect(410)).body.error.code).toBe(
      "PUBLIC_LINK_EXPIRED",
    );
    expect(
      (
        await decisionRequest(expired.rawToken)
          .send({ decision: QuoteDecision.DECLINED })
          .expect(410)
      ).body.error.code,
    ).toBe("PUBLIC_LINK_EXPIRED");
    const superseded = await createPublicCase({
      quoteStatus: QuoteStatus.SUPERSEDED,
      revokedAt: new Date(),
    });
    expect((await readRequest(superseded.rawToken).expect(410)).body.error.code).toBe(
      "PUBLIC_QUOTE_UNAVAILABLE",
    );
    expect(
      (
        await decisionRequest(superseded.rawToken)
          .send({ decision: QuoteDecision.DECLINED })
          .expect(410)
      ).body.error.code,
    ).toBe("PUBLIC_QUOTE_UNAVAILABLE");
    const quoteExpired = await createPublicCase({
      quoteExpiresAt: new Date(Date.now() - 1000),
    });
    expect((await readRequest(quoteExpired.rawToken).expect(410)).body.error.code).toBe(
      "PUBLIC_QUOTE_UNAVAILABLE",
    );
    expect(
      (
        await decisionRequest(quoteExpired.rawToken)
          .send({ decision: QuoteDecision.DECLINED })
          .expect(410)
      ).body.error.code,
    ).toBe("PUBLIC_QUOTE_UNAVAILABLE");
    const wrongBound = await createPublicCase({ bindQuoteToDifferentOrder: true });
    expect((await readRequest(wrongBound.rawToken).expect(404)).body.error.code).toBe(
      "PUBLIC_LINK_INVALID",
    );
    expect(
      (
        await decisionRequest(wrongBound.rawToken)
          .send({ decision: QuoteDecision.DECLINED })
          .expect(404)
      ).body.error.code,
    ).toBe("PUBLIC_LINK_INVALID");
  });

  it("accepts the full quote with an authoritative snapshot and total", async () => {
    const testCase = await createPublicCase();
    const response = await decisionRequest(testCase.rawToken)
      .send({ decision: QuoteDecision.ACCEPTED, customerNote: "  Approved by customer  " })
      .expect(200);
    expect(response.body.data).toMatchObject({
      quoteVersionId: testCase.quoteId,
      decision: QuoteDecision.ACCEPTED,
      approvedTotal: 200,
    });

    const [quote, approval, order, outbox] = await Promise.all([
      prisma.quoteVersion.findUniqueOrThrow({ where: { id: testCase.quoteId! } }),
      prisma.quoteApproval.findUniqueOrThrow({ where: { quoteVersionId: testCase.quoteId! } }),
      prisma.repairOrder.findUniqueOrThrow({ where: { id: testCase.orderId } }),
      prisma.outboxEvent.findFirstOrThrow({
        where: { aggregateId: testCase.quoteId!, eventType: "QUOTE_DECIDED" },
      }),
    ]);
    expect(quote.status).toBe(QuoteStatus.ACCEPTED);
    expect(approval).toMatchObject({
      decision: QuoteDecision.ACCEPTED,
      approvedTotal: 200n,
      customerNote: "Approved by customer",
    });
    expect(approval.approvedItemSnapshot).toHaveLength(4);
    expect(approval.actorFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(approval.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      JSON.stringify(approval, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain("RF037 integration user agent");
    expect(order).toMatchObject({ status: RepairOrderStatus.APPROVED, lockVersion: 1 });
    expect(outbox).toMatchObject({ status: OutboxStatus.PENDING, attempts: 0 });
    expect(JSON.stringify(outbox.payload)).not.toContain(testCase.rawToken);
  });

  it("supports valid partial groups and applies the full discount once", async () => {
    const testCase = await createPublicCase();
    const response = await decisionRequest(testCase.rawToken)
      .send({
        decision: QuoteDecision.PARTIALLY_ACCEPTED,
        approvedItemIds: [testCase.itemIds!.groupB, testCase.itemIds!.groupA],
      })
      .expect(200);
    expect(response.body.data.approvedTotal).toBe(150);
    const approval = await prisma.quoteApproval.findUniqueOrThrow({
      where: { quoteVersionId: testCase.quoteId! },
    });
    expect(approval.decision).toBe(QuoteDecision.PARTIALLY_ACCEPTED);
    expect(approval.approvedTotal).toBe(150n);
    expect((approval.approvedItemSnapshot as Array<{ id: string }>).map(({ id }) => id)).toEqual([
      testCase.itemIds!.required,
      testCase.itemIds!.groupA,
      testCase.itemIds!.groupB,
    ]);
    expect(
      await prisma.repairOrder.findUniqueOrThrow({ where: { id: testCase.orderId } }),
    ).toMatchObject({ status: RepairOrderStatus.APPROVED, lockVersion: 1 });
  });

  it("rejects invalid optional selections without partial writes", async () => {
    const grouped = await createPublicCase();
    const groupedResponse = await decisionRequest(grouped.rawToken)
      .send({
        decision: QuoteDecision.PARTIALLY_ACCEPTED,
        approvedItemIds: [grouped.itemIds!.groupA],
      })
      .expect(422);
    expect(groupedResponse.body.error.code).toBe("QUOTE_APPROVAL_GROUP_INVALID");

    const required = await createPublicCase();
    await decisionRequest(required.rawToken)
      .send({
        decision: QuoteDecision.PARTIALLY_ACCEPTED,
        approvedItemIds: [required.itemIds!.required],
      })
      .expect(422);

    const allOptional = await createPublicCase();
    await decisionRequest(allOptional.rawToken)
      .send({
        decision: QuoteDecision.PARTIALLY_ACCEPTED,
        approvedItemIds: [
          allOptional.itemIds!.groupA,
          allOptional.itemIds!.groupB,
          allOptional.itemIds!.independent,
        ],
      })
      .expect(422);

    const declined = await createPublicCase();
    await decisionRequest(declined.rawToken)
      .send({
        decision: QuoteDecision.DECLINED,
        approvedItemIds: [declined.itemIds!.independent],
      })
      .expect(422);

    for (const testCase of [grouped, required, allOptional, declined]) {
      expect(
        await prisma.quoteApproval.count({ where: { quoteVersionId: testCase.quoteId! } }),
      ).toBe(0);
      expect(
        await prisma.quoteVersion.findUniqueOrThrow({ where: { id: testCase.quoteId! } }),
      ).toMatchObject({ status: QuoteStatus.SENT, decidedAt: null });
      expect(
        await prisma.repairOrder.findUniqueOrThrow({ where: { id: testCase.orderId } }),
      ).toMatchObject({ status: RepairOrderStatus.AWAITING_APPROVAL, lockVersion: 0 });
    }
  });

  it("declines into ready-for-pickup with the binding completion outcome", async () => {
    const testCase = await createPublicCase();
    const response = await decisionRequest(testCase.rawToken)
      .send({ decision: QuoteDecision.DECLINED })
      .expect(200);
    expect(response.body.data).toMatchObject({
      decision: QuoteDecision.DECLINED,
      approvedTotal: 0,
    });
    const [approval, order] = await Promise.all([
      prisma.quoteApproval.findUniqueOrThrow({ where: { quoteVersionId: testCase.quoteId! } }),
      prisma.repairOrder.findUniqueOrThrow({ where: { id: testCase.orderId } }),
    ]);
    expect(approval.approvedItemSnapshot).toEqual([]);
    expect(order).toMatchObject({
      status: RepairOrderStatus.READY_FOR_PICKUP,
      completionOutcome: CompletionOutcome.DECLINED_QUOTE,
      lockVersion: 1,
    });
    expect(order.readyAt).not.toBeNull();
  });

  it("replays the same decision, rejects mismatched payload, and enforces finality", async () => {
    const testCase = await createPublicCase();
    const key = `rf037-replay-${randomUUID()}`;
    const payload = {
      decision: QuoteDecision.PARTIALLY_ACCEPTED,
      approvedItemIds: [testCase.itemIds!.independent],
    };
    const first = await decisionRequest(testCase.rawToken, key).send(payload).expect(200);
    const replay = await decisionRequest(testCase.rawToken, key).send(payload).expect(200);
    expect(replay.body).toEqual(first.body);
    expect(
      (
        await decisionRequest(testCase.rawToken, key)
          .send({ ...payload, customerNote: "changed" })
          .expect(409)
      ).body.error.code,
    ).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      (
        await decisionRequest(testCase.rawToken)
          .send({ decision: QuoteDecision.DECLINED })
          .expect(409)
      ).body.error.code,
    ).toBe("QUOTE_ALREADY_DECIDED");
    expect(await prisma.quoteApproval.count({ where: { quoteVersionId: testCase.quoteId! } })).toBe(
      1,
    );
    expect(
      await prisma.orderEvent.count({
        where: { repairOrderId: testCase.orderId, eventType: "QUOTE_DECIDED" },
      }),
    ).toBe(1);

    const read = await readRequest(testCase.rawToken).expect(200);
    expect(read.body.data.quote.status).toBe(QuoteStatus.PARTIALLY_ACCEPTED);
    expect(read.body.data.quote.decidedAt).toBe(first.body.data.decidedAt);
  });

  it("allows exactly one concurrent final decision", async () => {
    const testCase = await createPublicCase();
    const [accepted, declined] = await Promise.all([
      decisionRequest(testCase.rawToken).send({ decision: QuoteDecision.ACCEPTED }),
      decisionRequest(testCase.rawToken).send({ decision: QuoteDecision.DECLINED }),
    ]);
    expect([accepted.status, declined.status].sort()).toEqual([200, 409]);
    expect(await prisma.quoteApproval.count({ where: { quoteVersionId: testCase.quoteId! } })).toBe(
      1,
    );
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: testCase.quoteId!, eventType: "QUOTE_DECIDED" },
      }),
    ).toBe(1);
  });

  it("rolls back quote, approval, transition, timeline, outbox, and idempotency on late failure", async () => {
    const testCase = await createPublicCase();
    const key = `rf037-rollback-${randomUUID()}`;
    const functionName = `rf037_fail_outbox_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const triggerName = `${functionName}_trigger`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."aggregateId" = '${testCase.quoteId}' THEN
          RAISE EXCEPTION 'forced RF-037 outbox failure';
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
      await decisionRequest(testCase.rawToken, key)
        .send({ decision: QuoteDecision.ACCEPTED })
        .expect(500);
      expect(
        await prisma.quoteVersion.findUniqueOrThrow({ where: { id: testCase.quoteId! } }),
      ).toMatchObject({ status: QuoteStatus.SENT, decidedAt: null });
      expect(
        await prisma.quoteApproval.count({ where: { quoteVersionId: testCase.quoteId! } }),
      ).toBe(0);
      expect(
        await prisma.repairOrder.findUniqueOrThrow({ where: { id: testCase.orderId } }),
      ).toMatchObject({ status: RepairOrderStatus.AWAITING_APPROVAL, lockVersion: 0 });
      expect(
        await prisma.orderEvent.count({
          where: { repairOrderId: testCase.orderId, eventType: "QUOTE_DECIDED" },
        }),
      ).toBe(0);
      expect(
        await prisma.outboxEvent.count({
          where: { aggregateId: testCase.quoteId!, eventType: "QUOTE_DECIDED" },
        }),
      ).toBe(0);
      expect(
        await prisma.idempotencyRecord.count({
          where: {
            shopId: fixture.shopId,
            scope: "public.quote-decision",
            keyHash: createHash("sha256").update(key).digest("hex"),
          },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "outbox_events";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  });

  it("rate-limits public access and redacts tokens from errors and log URLs", async () => {
    rateLimiter.clear();
    const rawToken = randomBytes(32).toString("base64url");
    let lastResponse: Awaited<ReturnType<typeof readRequest>>;
    for (let index = 0; index <= 60; index += 1) {
      lastResponse = await readRequest(rawToken);
    }

    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.body.error.code).toBe("RATE_LIMITED");
    expect(lastResponse!.headers["retry-after"]).toBeDefined();
    expect(JSON.stringify(lastResponse!.body)).not.toContain(rawToken);
    expect(redactPublicTokenUrl(`/public/v1/orders/${rawToken}?view=quote`)).toBe(
      "/public/v1/orders/[REDACTED]?view=quote",
    );
    expect(redactPublicTokenUrl(`/public/v1/quotes/${rawToken}/decision`)).toBe(
      "/public/v1/quotes/[REDACTED]/decision",
    );
    const serializedRequest = redactPublicTokenRequest({
      url: `/public/v1/orders/${rawToken}`,
      params: { path: ["orders", rawToken], token: rawToken },
    });
    expect(serializedRequest).toEqual({
      url: "/public/v1/orders/[REDACTED]",
      params: "[REDACTED]",
    });
    expect(JSON.stringify(serializedRequest)).not.toContain(rawToken);
    rateLimiter.clear();
  });
});
