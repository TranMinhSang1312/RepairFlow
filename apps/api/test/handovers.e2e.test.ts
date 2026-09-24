import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  CompletionOutcome,
  DeviceType,
  MediaPurpose,
  MembershipRole,
  MembershipStatus,
  PaymentDisposition,
  PaymentMethod,
  QuoteDecision,
  QuoteStatus,
  RepairOrderStatus,
  TokenScope,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { TokenService } from "../src/common/auth/token.service.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
  type PresignPutInput,
  type StoredObjectMetadata,
} from "../src/infra/object-storage/object-storage.port.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";

class FakeObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, StoredObjectMetadata>();

  presignPut(input: PresignPutInput): Promise<string> {
    return Promise.resolve(`https://storage.test/${encodeURIComponent(input.objectKey)}`);
  }

  head(objectKey: string): Promise<StoredObjectMetadata | null> {
    return Promise.resolve(this.objects.get(objectKey) ?? null);
  }

  delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
    return Promise.resolve();
  }
}

describe("RF-047 atomic handover API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let shopAId: string;
  let shopBId: string;
  let branchAId: string;
  let branchBId: string;
  let customerAId: string;
  let customerBId: string;
  let deviceAId: string;
  let deviceBId: string;
  let ownerAId: string;
  let ownerBId: string;
  let ownerToken: string;
  let receptionistToken: string;
  let technicianToken: string;
  let ownerBToken: string;
  let userIds: string[];
  let orderNo = 1;
  const storage = new FakeObjectStorage();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);
    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `Handover A ${suffix}`, slug: `handover-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `Handover B ${suffix}`, slug: `handover-b-${suffix}` } }),
    ]);
    shopAId = shopA.id;
    shopBId = shopB.id;
    const [branchA, branchB, customerA, customerB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopAId, name: "Main A" } }),
      prisma.branch.create({ data: { shopId: shopBId, name: "Main B" } }),
      prisma.customer.create({
        data: {
          shopId: shopAId,
          name: "Handover customer A",
          phoneRaw: "0900000301",
          phoneNormalized: "+84900000301",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopBId,
          name: "Handover customer B",
          phoneRaw: "0900000302",
          phoneNormalized: "+84900000302",
        },
      }),
    ]);
    branchAId = branchA.id;
    branchBId = branchB.id;
    customerAId = customerA.id;
    customerBId = customerB.id;
    const [deviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopAId,
          customerId: customerAId,
          type: DeviceType.LAPTOP,
          brand: "Test",
          model: "Handover A",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopBId,
          customerId: customerBId,
          type: DeviceType.PHONE,
          brand: "Test",
          model: "Handover B",
        },
      }),
    ]);
    deviceAId = deviceA.id;
    deviceBId = deviceB.id;
    const specs = [
      ["Owner A", MembershipRole.OWNER, shopAId],
      ["Receptionist A", MembershipRole.RECEPTIONIST, shopAId],
      ["Technician A", MembershipRole.TECHNICIAN, shopAId],
      ["Owner B", MembershipRole.OWNER, shopBId],
    ] as const;
    const users = await Promise.all(
      specs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf047-handover-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    userIds = users.map((user) => user.id);
    ownerAId = users[0]!.id;
    ownerBId = users[3]!.id;
    await prisma.shopMembership.createMany({
      data: specs.map(([, role, shopId], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status: MembershipStatus.ACTIVE,
      })),
    });
    ownerToken = tokens.createAccessToken(users[0]!.id).token;
    receptionistToken = tokens.createAccessToken(users[1]!.id).token;
    technicianToken = tokens.createAccessToken(users[2]!.id).token;
    ownerBToken = tokens.createAccessToken(users[3]!.id).token;
  });

  afterAll(async () => {
    const shops = [shopAId, shopBId];
    await prisma.notificationDelivery.deleteMany({
      where: { outboxEvent: { shopId: { in: shops } } },
    });
    await prisma.outboxEvent.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.auditLog.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.publicAccessToken.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.warranty.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.handover.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.payment.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.mediaAsset.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.quoteApproval.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.quoteItem.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.quoteVersion.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.shop.deleteMany({ where: { id: { in: shops } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  async function createReadyOrder(options?: {
    shop?: "A" | "B";
    status?: RepairOrderStatus;
    completionOutcome?: CompletionOutcome | null;
    approvedTotal?: bigint | null;
    priorPayments?: bigint[];
    lockVersion?: number;
  }) {
    const inA = options?.shop !== "B";
    const shopId = inA ? shopAId : shopBId;
    const actorId = inA ? ownerAId : ownerBId;
    const number = orderNo++;
    const outcome =
      options && "completionOutcome" in options
        ? options.completionOutcome
        : CompletionOutcome.REPAIRED;
    const order = await prisma.repairOrder.create({
      data: {
        shopId,
        branchId: inA ? branchAId : branchBId,
        customerId: inA ? customerAId : customerBId,
        deviceId: inA ? deviceAId : deviceBId,
        orderNo: number,
        code: `HAND-${inA ? "A" : "B"}-${number}`,
        status: options?.status ?? RepairOrderStatus.READY_FOR_PICKUP,
        completionOutcome: outcome,
        lockVersion: options?.lockVersion ?? 0,
        readyAt: new Date(),
        reportedProblem: "Handover integration",
        intakeCondition: "Good",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "Handover customer", phone: "0900000301" },
        deviceSnapshot: { type: DeviceType.LAPTOP, brand: "Test", model: "Handover" },
        createdByUserId: actorId,
      },
    });
    let quoteVersionId: string | null = null;
    if (options?.approvedTotal !== null) {
      const approvedTotal = options?.approvedTotal ?? 100_000n;
      const quote = await prisma.quoteVersion.create({
        data: {
          shopId,
          repairOrderId: order.id,
          versionNo: 1,
          status: QuoteStatus.ACCEPTED,
          subtotal: approvedTotal,
          total: approvedTotal,
          sentAt: new Date(),
          decidedAt: new Date(),
          createdByUserId: actorId,
        },
      });
      quoteVersionId = quote.id;
      await prisma.quoteApproval.create({
        data: {
          shopId,
          quoteVersionId: quote.id,
          decision: QuoteDecision.ACCEPTED,
          approvedItemSnapshot: [],
          approvedTotal,
          idempotencyKeyHash: randomUUID(),
        },
      });
    }
    for (const amount of options?.priorPayments ?? []) {
      await prisma.payment.create({
        data: {
          shopId,
          repairOrderId: order.id,
          amount,
          method: PaymentMethod.CASH,
          receivedByUserId: actorId,
        },
      });
    }
    return { orderId: order.id, shopId, quoteVersionId };
  }

  function postHandover(
    orderId: string,
    token = ownerToken,
    shopId = shopAId,
    key = `handover-${randomUUID()}`,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/handovers`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", shopId)
      .set("Idempotency-Key", key);
  }

  function repairedPayload(overrides: Record<string, unknown> = {}) {
    return {
      recipientName: "Customer",
      paymentDisposition: PaymentDisposition.PAID,
      expectedLockVersion: 0,
      payment: { amount: 100_000, method: PaymentMethod.CASH, reference: "final receipt" },
      warranty: {
        endsAt: new Date(Date.now() + 400 * 24 * 60 * 60 * 1_000).toISOString(),
        terms: "Parts and labor warranty",
      },
      ...overrides,
    };
  }

  it("atomically completes repaired handover, revokes old tokens and exposes one TRACK URL", async () => {
    const { orderId, quoteVersionId } = await createReadyOrder();
    await prisma.publicAccessToken.createMany({
      data: [
        {
          shopId: shopAId,
          repairOrderId: orderId,
          quoteVersionId,
          scope: TokenScope.DECIDE_QUOTE,
          tokenHash: `old-decide-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        {
          shopId: shopAId,
          repairOrderId: orderId,
          scope: TokenScope.TRACK_ORDER,
          tokenHash: `old-track-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      ],
    });
    const objectKey = `shops/${shopAId}/orders/${orderId}/signature.jpg`;
    const media = await prisma.mediaAsset.create({
      data: {
        shopId: shopAId,
        repairOrderId: orderId,
        purpose: MediaPurpose.SIGNATURE,
        objectKey,
        originalName: "signature.jpg",
        mimeType: "image/jpeg",
        byteSize: 123,
        uploadedByUserId: ownerAId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    storage.objects.set(objectKey, { byteSize: 123, mimeType: "image/jpeg", checksumSha256: null });
    const key = `handover-success-${randomUUID()}`;
    const response = await postHandover(orderId, receptionistToken, shopAId, key).send(
      repairedPayload({ signatureMediaAssetId: media.id }),
    );
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      order: { id: orderId, status: "COMPLETED", lockVersion: 1 },
      payment: { amount: 100_000, method: "CASH", reference: "final receipt" },
      paymentSummary: { approvedTotal: 100_000, paidTotal: 100_000, amountDue: 0 },
    });
    expect(response.body.data.warranty.startsAt).toBe(response.body.data.handover.handedOverAt);
    expect(response.body.data.order.returnedAt).toBe(response.body.data.handover.handedOverAt);

    const tokens = await prisma.publicAccessToken.findMany({
      where: { shopId: shopAId, repairOrderId: orderId },
      orderBy: { createdAt: "asc" },
    });
    expect(tokens.filter((token) => token.revokedAt === null)).toHaveLength(1);
    expect(tokens.at(-1)?.scope).toBe(TokenScope.TRACK_ORDER);
    expect(new Date(response.body.data.trackingExpiresAt as string).getTime()).toBeGreaterThan(
      new Date(response.body.data.handover.handedOverAt as string).getTime() +
        365 * 24 * 60 * 60 * 1_000,
    );
    expect(
      await prisma.notificationDelivery.count({ where: { outboxEvent: { shopId: shopAId } } }),
    ).toBe(0);

    const rawToken = new URL(response.body.data.trackingUrl as string).pathname.split("/").at(-1)!;
    const publicRead = await request(app.getHttpServer()).get(`/public/v1/orders/${rawToken}`);
    expect(publicRead.status).toBe(200);
    expect(publicRead.body.data.orderCode).toBe(response.body.data.order.code);
    const expiryAfterRead = await prisma.publicAccessToken.findFirstOrThrow({
      where: { repairOrderId: orderId, revokedAt: null },
      select: { expiresAt: true, lastUsedAt: true },
    });
    expect(expiryAfterRead.expiresAt.toISOString()).toBe(response.body.data.trackingExpiresAt);
    expect(expiryAfterRead.lastUsedAt).not.toBeNull();
    const decision = await request(app.getHttpServer())
      .post(`/public/v1/quotes/${rawToken}/decision`)
      .set("Idempotency-Key", `track-cannot-decide-${randomUUID()}`)
      .send({ decision: "ACCEPTED" });
    expect(decision.status).toBe(404);

    const stored = JSON.stringify({
      idempotency: await prisma.idempotencyRecord.findMany({ where: { shopId: shopAId } }),
      events: await prisma.orderEvent.findMany({
        where: { shopId: shopAId, repairOrderId: orderId },
      }),
      outbox: await prisma.outboxEvent.findMany({
        where: { shopId: shopAId, aggregateId: orderId },
      }),
      audit: await prisma.auditLog.findMany({ where: { shopId: shopAId, entityId: orderId } }),
    });
    expect(stored).not.toContain(rawToken);
    expect(stored).not.toContain(response.body.data.trackingUrl as string);
    expect(stored).not.toContain("0900000301");
    expect(stored).not.toContain("final receipt");
  });

  it("replays the same URL, rejects mismatch, and never mints after replay expiry", async () => {
    const { orderId } = await createReadyOrder();
    const key = `handover-replay-${randomUUID()}`;
    const payload = repairedPayload();
    const first = await postHandover(orderId, ownerToken, shopAId, key).send(payload);
    expect(first.status).toBe(201);
    const replay = await postHandover(orderId, ownerToken, shopAId, key).send(payload);
    expect(replay.status).toBe(201);
    expect(replay.body.data.trackingUrl).toBe(first.body.data.trackingUrl);
    expect(await prisma.handover.count({ where: { repairOrderId: orderId } })).toBe(1);
    expect(await prisma.publicAccessToken.count({ where: { repairOrderId: orderId } })).toBe(1);
    const mismatch = await postHandover(orderId, ownerToken, shopAId, key).send(
      repairedPayload({ recipientName: "Another recipient" }),
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const records = await prisma.idempotencyRecord.findMany({
      where: { shopId: shopAId, scope: "handovers.complete" },
    });
    const record = records.find(
      (candidate) =>
        (candidate.responseBody as { repairOrderId?: string }).repairOrderId === orderId,
    )!;
    await prisma.idempotencyRecord.update({
      where: { id: record.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const tokenCount = await prisma.publicAccessToken.count({ where: { repairOrderId: orderId } });
    const expired = await postHandover(orderId, ownerToken, shopAId, key).send(payload);
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe("TOKEN_EXPIRED");
    expect(await prisma.publicAccessToken.count({ where: { repairOrderId: orderId } })).toBe(
      tokenCount,
    );
  });

  it("enforces role, tenant, ready state and optimistic lock", async () => {
    const technician = await createReadyOrder();
    expect(
      (await postHandover(technician.orderId, technicianToken).send(repairedPayload())).status,
    ).toBe(403);
    expect(
      (await postHandover(technician.orderId, ownerBToken, shopBId).send(repairedPayload())).status,
    ).toBe(404);
    const repairing = await createReadyOrder({ status: RepairOrderStatus.REPAIRING });
    expect((await postHandover(repairing.orderId).send(repairedPayload())).body.error.code).toBe(
      "REPAIR_ORDER_INVALID_TRANSITION",
    );
    const stale = await createReadyOrder({ lockVersion: 2 });
    expect((await postHandover(stale.orderId).send(repairedPayload())).body.error.code).toBe(
      "CONCURRENT_UPDATE",
    );
    const missingOutcome = await createReadyOrder({ completionOutcome: null });
    expect(
      (await postHandover(missingOutcome.orderId).send(repairedPayload())).body.error.code,
    ).toBe("COMPLETION_OUTCOME_REQUIRED");
  });

  it("applies disposition and repaired-only warranty rules", async () => {
    const partial = await createReadyOrder({ approvedTotal: 100n, priorPayments: [10n] });
    const validPartial = await postHandover(partial.orderId).send(
      repairedPayload({
        paymentDisposition: PaymentDisposition.PARTIALLY_PAID,
        paymentNote: "Balance remains",
        payment: null,
      }),
    );
    expect(validPartial.status).toBe(201);
    expect(validPartial.body.data.paymentSummary).toEqual({
      approvedTotal: 100,
      paidTotal: 10,
      amountDue: 90,
    });

    const missingNote = await createReadyOrder({ approvedTotal: 100n, priorPayments: [10n] });
    expect(
      (
        await postHandover(missingNote.orderId).send(
          repairedPayload({
            paymentDisposition: PaymentDisposition.PARTIALLY_PAID,
            paymentNote: " ",
            payment: null,
          }),
        )
      ).body.error.code,
    ).toBe("PAYMENT_DISPOSITION_INVALID");

    const missingWarranty = await createReadyOrder();
    expect(
      (await postHandover(missingWarranty.orderId).send(repairedPayload({ warranty: null }))).body
        .error.code,
    ).toBe("WARRANTY_REQUIRED");

    const nonRepaired = await createReadyOrder({
      completionOutcome: CompletionOutcome.DECLINED_QUOTE,
      approvedTotal: null,
    });
    const zero = await postHandover(nonRepaired.orderId).send({
      recipientName: "Customer",
      paymentDisposition: PaymentDisposition.PAID,
      expectedLockVersion: 0,
    });
    expect(zero.status).toBe(201);
    expect(zero.body.data.paymentSummary).toEqual({ approvedTotal: 0, paidTotal: 0, amountDue: 0 });
    expect(zero.body.data.warranty).toBeNull();

    const forbiddenPayment = await createReadyOrder({
      completionOutcome: CompletionOutcome.UNREPAIRABLE,
      approvedTotal: null,
    });
    expect(
      (
        await postHandover(forbiddenPayment.orderId).send({
          recipientName: "Customer",
          paymentDisposition: PaymentDisposition.PAID,
          expectedLockVersion: 0,
          payment: { amount: 1, method: PaymentMethod.CASH },
        })
      ).body.error.code,
    ).toBe("PAYMENT_NOT_ALLOWED");
  });

  it("rejects wrong-purpose and incomplete handover media", async () => {
    const wrongPurpose = await createReadyOrder();
    const wrongAsset = await prisma.mediaAsset.create({
      data: {
        shopId: shopAId,
        repairOrderId: wrongPurpose.orderId,
        purpose: MediaPurpose.QC,
        objectKey: `wrong-purpose-${randomUUID()}`,
        originalName: "qc.jpg",
        mimeType: "image/jpeg",
        byteSize: 10,
        uploadedByUserId: ownerAId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const wrongResponse = await postHandover(wrongPurpose.orderId).send(
      repairedPayload({ signatureMediaAssetId: wrongAsset.id }),
    );
    expect(wrongResponse.status).toBe(404);

    const incomplete = await createReadyOrder();
    const missingObject = await prisma.mediaAsset.create({
      data: {
        shopId: shopAId,
        repairOrderId: incomplete.orderId,
        purpose: MediaPurpose.SIGNATURE,
        objectKey: `missing-object-${randomUUID()}`,
        originalName: "signature.jpg",
        mimeType: "image/jpeg",
        byteSize: 10,
        uploadedByUserId: ownerAId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const incompleteResponse = await postHandover(incomplete.orderId).send(
      repairedPayload({ signatureMediaAssetId: missingObject.id }),
    );
    expect(incompleteResponse.status).toBe(409);
    expect(incompleteResponse.body.error.code).toBe("MEDIA_UPLOAD_INCOMPLETE");
  });

  it("allows only one winner for concurrent handovers", async () => {
    const { orderId } = await createReadyOrder();
    const responses = await Promise.all([
      postHandover(orderId).send(repairedPayload()),
      postHandover(orderId).send(repairedPayload()),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.handover.count({ where: { repairOrderId: orderId } })).toBe(1);
    expect(await prisma.warranty.count({ where: { repairOrderId: orderId } })).toBe(1);
    expect(
      await prisma.publicAccessToken.count({
        where: { repairOrderId: orderId, scope: TokenScope.TRACK_ORDER, revokedAt: null },
      }),
    ).toBe(1);
  });

  it("rolls every handover write back when the domain outbox insert fails", async () => {
    const { orderId } = await createReadyOrder();
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `rf047_fail_${suffix}`;
    const triggerName = `rf047_trigger_${suffix}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."aggregateId" = '${orderId}'::uuid THEN
          RAISE EXCEPTION 'forced RF-047 outbox failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "outbox_events"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);
    try {
      expect((await postHandover(orderId).send(repairedPayload())).status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "outbox_events"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
    expect(await prisma.payment.count({ where: { repairOrderId: orderId } })).toBe(0);
    expect(await prisma.handover.count({ where: { repairOrderId: orderId } })).toBe(0);
    expect(await prisma.warranty.count({ where: { repairOrderId: orderId } })).toBe(0);
    expect(await prisma.publicAccessToken.count({ where: { repairOrderId: orderId } })).toBe(0);
    expect((await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      RepairOrderStatus.READY_FOR_PICKUP,
    );
  });

  it("rolls finalized media and every write back when idempotency persistence fails", async () => {
    const { orderId } = await createReadyOrder();
    const objectKey = `shops/${shopAId}/orders/${orderId}/rollback-signature.jpg`;
    const media = await prisma.mediaAsset.create({
      data: {
        shopId: shopAId,
        repairOrderId: orderId,
        purpose: MediaPurpose.SIGNATURE,
        objectKey,
        originalName: "rollback-signature.jpg",
        mimeType: "image/jpeg",
        byteSize: 44,
        uploadedByUserId: ownerAId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    storage.objects.set(objectKey, { byteSize: 44, mimeType: "image/jpeg", checksumSha256: null });
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `rf047_idempotency_fail_${suffix}`;
    const triggerName = `rf047_idempotency_trigger_${suffix}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."shopId" = '${shopAId}'::uuid AND NEW."scope" = 'handovers.complete' THEN
          RAISE EXCEPTION 'forced RF-047 handover idempotency failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "idempotency_records"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);
    try {
      expect(
        (await postHandover(orderId).send(repairedPayload({ signatureMediaAssetId: media.id })))
          .status,
      ).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON "idempotency_records"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
    expect(await prisma.payment.count({ where: { repairOrderId: orderId } })).toBe(0);
    expect(await prisma.handover.count({ where: { repairOrderId: orderId } })).toBe(0);
    expect(await prisma.warranty.count({ where: { repairOrderId: orderId } })).toBe(0);
    expect(await prisma.publicAccessToken.count({ where: { repairOrderId: orderId } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: orderId } })).toBe(0);
    const rolledBackMedia = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: media.id } });
    expect(rolledBackMedia.uploadedAt).toBeNull();
    expect(rolledBackMedia.expiresAt).not.toBeNull();
    expect((await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      RepairOrderStatus.READY_FOR_PICKUP,
    );
  });
});
