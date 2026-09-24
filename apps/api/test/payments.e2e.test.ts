import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  CompletionOutcome,
  DeviceType,
  MembershipRole,
  MembershipStatus,
  PaymentDisposition,
  PaymentMethod,
  QuoteDecision,
  QuoteStatus,
  RepairOrderStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { TokenService } from "../src/common/auth/token.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";

describe("RF-047 payment API", () => {
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
  let inactiveToken: string;
  let ownerBToken: string;
  let userIds: string[];
  let orderNo = 1;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);
    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `Payments A ${suffix}`, slug: `payments-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `Payments B ${suffix}`, slug: `payments-b-${suffix}` } }),
    ]);
    shopAId = shopA.id;
    shopBId = shopB.id;
    const [branchA, branchB, customerA, customerB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopAId, name: "Main A" } }),
      prisma.branch.create({ data: { shopId: shopBId, name: "Main B" } }),
      prisma.customer.create({
        data: {
          shopId: shopAId,
          name: "Payment customer A",
          phoneRaw: "0900000201",
          phoneNormalized: "+84900000201",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopBId,
          name: "Payment customer B",
          phoneRaw: "0900000202",
          phoneNormalized: "+84900000202",
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
          model: "Payment A",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopBId,
          customerId: customerBId,
          type: DeviceType.PHONE,
          brand: "Test",
          model: "Payment B",
        },
      }),
    ]);
    deviceAId = deviceA.id;
    deviceBId = deviceB.id;

    const specs = [
      ["Owner A", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopAId],
      ["Receptionist A", MembershipRole.RECEPTIONIST, MembershipStatus.ACTIVE, shopAId],
      ["Technician A", MembershipRole.TECHNICIAN, MembershipStatus.ACTIVE, shopAId],
      ["Inactive A", MembershipRole.RECEPTIONIST, MembershipStatus.INACTIVE, shopAId],
      ["Owner B", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopBId],
    ] as const;
    const users = await Promise.all(
      specs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf047-payment-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    userIds = users.map((user) => user.id);
    ownerAId = users[0]!.id;
    ownerBId = users[4]!.id;
    await prisma.shopMembership.createMany({
      data: specs.map(([, role, status, shopId], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status,
      })),
    });
    ownerToken = tokens.createAccessToken(users[0]!.id).token;
    receptionistToken = tokens.createAccessToken(users[1]!.id).token;
    technicianToken = tokens.createAccessToken(users[2]!.id).token;
    inactiveToken = tokens.createAccessToken(users[3]!.id).token;
    ownerBToken = tokens.createAccessToken(users[4]!.id).token;
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
    await prisma.payment.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.handover.deleteMany({ where: { shopId: { in: shops } } });
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

  async function createOrder(options?: {
    shop?: "A" | "B";
    status?: RepairOrderStatus;
    approvedTotal?: bigint | null;
    priorPayments?: bigint[];
    handoverDisposition?: PaymentDisposition;
  }): Promise<string> {
    const inA = options?.shop !== "B";
    const shopId = inA ? shopAId : shopBId;
    const actorId = inA ? ownerAId : ownerBId;
    const number = orderNo++;
    const status = options?.status ?? RepairOrderStatus.READY_FOR_PICKUP;
    const order = await prisma.repairOrder.create({
      data: {
        shopId,
        branchId: inA ? branchAId : branchBId,
        customerId: inA ? customerAId : customerBId,
        deviceId: inA ? deviceAId : deviceBId,
        orderNo: number,
        code: `PAY-${inA ? "A" : "B"}-${number}`,
        status,
        completionOutcome: CompletionOutcome.REPAIRED,
        reportedProblem: "Payment integration",
        intakeCondition: "Good",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "Payment customer", phone: "0900000201" },
        deviceSnapshot: { type: DeviceType.LAPTOP, brand: "Test", model: "Payment" },
        createdByUserId: actorId,
        ...(status === RepairOrderStatus.COMPLETED
          ? { readyAt: new Date(Date.now() - 1_000), returnedAt: new Date() }
          : { readyAt: new Date() }),
      },
    });
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
    if (status === RepairOrderStatus.COMPLETED) {
      await prisma.handover.create({
        data: {
          shopId,
          repairOrderId: order.id,
          recipientName: "Customer",
          paymentDisposition: options?.handoverDisposition ?? PaymentDisposition.PARTIALLY_PAID,
          paymentNote: "Remaining balance",
          handedOverByUserId: actorId,
        },
      });
    }
    return order.id;
  }

  function postPayment(
    orderId: string,
    token = ownerToken,
    shopId = shopAId,
    key = `payment-${randomUUID()}`,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", shopId)
      .set("Idempotency-Key", key);
  }

  it("records authoritative payments for owner/receptionist and maps staff detail", async () => {
    const orderId = await createOrder({ approvedTotal: 150_000n, priorPayments: [20_000n] });
    const first = await postPayment(orderId).send({
      amount: 100_000,
      method: PaymentMethod.BANK_TRANSFER,
      reference: " bank-1 ",
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      payment: { amount: 100_000, method: "BANK_TRANSFER", reference: "bank-1" },
      summary: { approvedTotal: 150_000, paidTotal: 120_000, amountDue: 30_000 },
    });
    const second = await postPayment(orderId, receptionistToken).send({
      amount: 30_000,
      method: PaymentMethod.CASH,
    });
    expect(second.status).toBe(201);
    expect(second.body.data.summary).toEqual({
      approvedTotal: 150_000,
      paidTotal: 150_000,
      amountDue: 0,
    });
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/repair-orders/${orderId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("X-Shop-Id", shopAId);
    expect(detail.status).toBe(200);
    expect(detail.body.data.paymentSummary).toEqual(second.body.data.summary);
    expect(detail.body.data.payments).toHaveLength(3);
    expect(detail.body.data.handover).toBeNull();
    expect(detail.body.data.warranty).toBeNull();
  });

  it("enforces role, active membership and tenant isolation", async () => {
    const orderId = await createOrder();
    expect(
      (await postPayment(orderId, technicianToken).send({ amount: 1, method: "CASH" })).status,
    ).toBe(403);
    expect(
      (await postPayment(orderId, inactiveToken).send({ amount: 1, method: "CASH" })).status,
    ).toBe(403);
    expect(
      (
        await postPayment(orderId, ownerBToken, shopBId).send({
          amount: 1,
          method: "CASH",
        })
      ).status,
    ).toBe(404);
  });

  it("rejects missing approval, disallowed state, invalid money and overpayment", async () => {
    const noApproval = await createOrder({ approvedTotal: null });
    expect(
      (await postPayment(noApproval).send({ amount: 1, method: "CASH" })).body.error.code,
    ).toBe("APPROVED_SCOPE_REQUIRED");
    const repairing = await createOrder({ status: RepairOrderStatus.REPAIRING });
    expect((await postPayment(repairing).send({ amount: 1, method: "CASH" })).body.error.code).toBe(
      "PAYMENT_NOT_ALLOWED",
    );
    const bounded = await createOrder({ approvedTotal: 10n });
    expect((await postPayment(bounded).send({ amount: 11, method: "CASH" })).body.error.code).toBe(
      "PAYMENT_EXCEEDS_BALANCE",
    );
    expect((await postPayment(bounded).send({ amount: 0, method: "CASH" })).status).toBe(422);
    expect((await postPayment(bounded).send({ amount: 1.5, method: "CASH" })).status).toBe(422);
    expect((await postPayment(bounded).send({ amount: 1, method: "WIRE" })).status).toBe(422);
  });

  it("replays the original response and rejects key reuse with another payload", async () => {
    const orderId = await createOrder({ approvedTotal: 100n });
    const key = `payment-replay-${randomUUID()}`;
    const payload = { amount: 40, method: "CASH", reference: "receipt" };
    const first = await postPayment(orderId, ownerToken, shopAId, key).send(payload);
    const replay = await postPayment(orderId, ownerToken, shopAId, key).send(payload);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(await prisma.payment.count({ where: { repairOrderId: orderId } })).toBe(1);
    const mismatch = await postPayment(orderId, ownerToken, shopAId, key).send({
      ...payload,
      amount: 41,
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("serializes concurrent receipts so their sum cannot exceed due", async () => {
    const orderId = await createOrder({ approvedTotal: 100n });
    const responses = await Promise.all([
      postPayment(orderId).send({ amount: 70, method: "CASH" }),
      postPayment(orderId).send({ amount: 70, method: "CARD" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const rows = await prisma.payment.findMany({ where: { repairOrderId: orderId } });
    expect(rows.reduce((sum, payment) => sum + payment.amount, 0n)).toBe(70n);
  });

  it("allows only bounded partial/pay-later receipts after handover", async () => {
    const partial = await createOrder({
      status: RepairOrderStatus.COMPLETED,
      approvedTotal: 100n,
      priorPayments: [25n],
      handoverDisposition: PaymentDisposition.PARTIALLY_PAID,
    });
    const accepted = await postPayment(partial).send({ amount: 75, method: "CASH" });
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.summary.amountDue).toBe(0);

    const waived = await createOrder({
      status: RepairOrderStatus.COMPLETED,
      approvedTotal: 100n,
      handoverDisposition: PaymentDisposition.WAIVED,
    });
    expect((await postPayment(waived).send({ amount: 1, method: "CASH" })).body.error.code).toBe(
      "PAYMENT_NOT_ALLOWED",
    );
  });

  it("rolls payment, timeline and audit back when idempotency persistence fails", async () => {
    const orderId = await createOrder({ approvedTotal: 100n });
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `rf047_payment_fail_${suffix}`;
    const triggerName = `rf047_payment_trigger_${suffix}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."shopId" = '${shopAId}'::uuid AND NEW."scope" = 'payments.create' THEN
          RAISE EXCEPTION 'forced RF-047 payment idempotency failure';
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
      expect((await postPayment(orderId).send({ amount: 50, method: "CASH" })).status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON "idempotency_records"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
    expect(await prisma.payment.count({ where: { repairOrderId: orderId } })).toBe(0);
    expect(
      await prisma.orderEvent.count({
        where: { repairOrderId: orderId, eventType: "PAYMENT_RECORDED" },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: orderId, action: "PAYMENT_RECORDED" },
      }),
    ).toBe(0);
  });
});
