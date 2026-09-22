import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  DeviceType,
  MembershipRole,
  MembershipStatus,
  QuoteItemKind,
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
  inactiveReceptionistToken: string;
  userIds: string[];
}

describe("quote draft API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let nextOrderNo = 1;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);

    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `Quote A ${suffix}`, slug: `quote-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `Quote B ${suffix}`, slug: `quote-b-${suffix}` } }),
    ]);
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopA.id, name: "Quote Main A" } }),
      prisma.branch.create({ data: { shopId: shopB.id, name: "Quote Main B" } }),
    ]);
    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "Quote Customer A",
          phoneRaw: "0900000061",
          phoneNormalized: "+84900000061",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "Quote Customer B",
          phoneRaw: "0900000062",
          phoneNormalized: "+84900000062",
        },
      }),
    ]);
    const [deviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopA.id,
          customerId: customerA.id,
          type: DeviceType.PHONE,
          brand: "Quote",
          model: "A",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopB.id,
          customerId: customerB.id,
          type: DeviceType.LAPTOP,
          brand: "Quote",
          model: "B",
        },
      }),
    ]);

    const userSpecs = [
      ["Quote Owner A", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopA.id],
      ["Quote Receptionist A", MembershipRole.RECEPTIONIST, MembershipStatus.ACTIVE, shopA.id],
      ["Quote Technician A", MembershipRole.TECHNICIAN, MembershipStatus.ACTIVE, shopA.id],
      [
        "Quote Inactive Receptionist",
        MembershipRole.RECEPTIONIST,
        MembershipStatus.INACTIVE,
        shopA.id,
      ],
      ["Quote Owner B", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopB.id],
    ] as const;
    const users = await Promise.all(
      userSpecs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf035-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    await prisma.shopMembership.createMany({
      data: userSpecs.map(([, role, status, shopId], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status,
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
      ownerBId: users[4]!.id,
      ownerToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      inactiveReceptionistToken: tokenService.createAccessToken(users[3]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    if (!fixture) {
      await app.close();
      return;
    }
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.quoteItem.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteVersion.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.diagnosis.deleteMany({ where: { shopId: { in: shopIds } } });
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
        code: `QUOTE-${isShopA ? "A" : "B"}-${orderNo}`,
        status: options?.status ?? RepairOrderStatus.DIAGNOSING,
        reportedProblem: "Quote test problem",
        intakeCondition: "Used condition",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "Quote customer", phone: "0900000000" },
        deviceSnapshot: { type: DeviceType.PHONE, brand: "Quote", model: "Snapshot" },
        createdByUserId: isShopA ? fixture.ownerAId : fixture.ownerBId,
      },
    });
    return order.id;
  }

  async function createDiagnosis(orderId: string, shop: "A" | "B" = "A"): Promise<string> {
    const diagnosis = await prisma.diagnosis.create({
      data: {
        shopId: shop === "A" ? fixture.shopAId : fixture.shopBId,
        repairOrderId: orderId,
        revisionNo: 1,
        finding: "Quote test finding",
        recommendation: "Quote test recommendation",
        createdByUserId: shop === "A" ? fixture.ownerAId : fixture.ownerBId,
      },
    });
    return diagnosis.id;
  }

  function createRequest(orderId: string, token = fixture.ownerToken, shopId = fixture.shopAId) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/quotes`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", shopId);
  }

  function replaceRequest(
    quoteVersionId: string,
    token = fixture.ownerToken,
    shopId = fixture.shopAId,
  ) {
    return request(app.getHttpServer())
      .patch(`/api/v1/quotes/${quoteVersionId}`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", shopId);
  }

  const payload = (diagnosisId?: string) => ({
    diagnosisId: diagnosisId ?? null,
    discount: 51,
    customerNote: "Customer-visible quote note",
    expiresAt: "2099-12-31T00:00:00.000Z",
    items: [
      {
        kind: QuoteItemKind.SERVICE,
        description: "Required service",
        quantity: 1.25,
        unitPrice: 1001,
        isOptional: false,
      },
      {
        kind: QuoteItemKind.PART,
        description: "Optional part bundle",
        quantity: 0.5,
        unitPrice: 999,
        isOptional: true,
        approvalGroup: "bundle-a",
      },
    ],
  });

  it("creates authoritative versions for owner/receptionist and maps history without BigInt leaks", async () => {
    const orderId = await createOrder();
    const diagnosisId = await createDiagnosis(orderId);
    const first = await createRequest(orderId)
      .set("X-Request-Id", "req-rf035-owner")
      .send(payload(diagnosisId))
      .expect(201);
    const second = await createRequest(orderId, fixture.receptionistToken)
      .send(payload(diagnosisId))
      .expect(201);

    expect(first.body.data).toMatchObject({
      repairOrderId: orderId,
      diagnosisId,
      versionNo: 1,
      status: QuoteStatus.DRAFT,
      currency: "VND",
      subtotal: 1751,
      discount: 51,
      total: 1700,
      customerNote: "Customer-visible quote note",
    });
    expect(first.body.data.items.map((item: { lineTotal: number }) => item.lineTotal)).toEqual([
      1251, 500,
    ]);
    expect(second.body.data.versionNo).toBe(2);
    expect(JSON.stringify(first.body)).not.toContain("BigInt");
    expect(first.body.data).not.toHaveProperty("createdByUserId");
    expect(first.body.data).not.toHaveProperty("shopId");

    const persisted = await prisma.quoteVersion.findUniqueOrThrow({
      where: { id: first.body.data.id },
    });
    expect(persisted).toMatchObject({ subtotal: 1751n, discount: 51n, total: 1700n });
    const event = await prisma.orderEvent.findFirstOrThrow({
      where: { repairOrderId: orderId, eventType: "QUOTE_DRAFT_CREATED" },
    });
    expect(event).toMatchObject({ actorUserId: fixture.ownerAId, requestId: "req-rf035-owner" });
    expect(event.publicPayload).toBeNull();

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/repair-orders/${orderId}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(200);
    expect(
      detail.body.data.quoteVersions.map((quote: { versionNo: number }) => quote.versionNo),
    ).toEqual([1, 2]);
    expect(detail.body.data.quoteVersions[0]).toEqual(first.body.data);
  });

  it("replaces all editable draft fields and items without changing versionNo", async () => {
    const orderId = await createOrder();
    const created = await createRequest(orderId).send(payload()).expect(201);
    const oldItemIds = created.body.data.items.map((item: { id: string }) => item.id);
    const replacement = {
      diagnosisId: null,
      discount: 100,
      customerNote: "Revised quote",
      expiresAt: null,
      items: [
        {
          kind: QuoteItemKind.FEE,
          description: "Replacement fee",
          quantity: 2.5,
          unitPrice: 1000,
          isOptional: true,
          approvalGroup: "",
        },
      ],
    };
    const updated = await replaceRequest(created.body.data.id)
      .set("X-Request-Id", "req-rf035-update")
      .send(replacement)
      .expect(200);

    expect(updated.body.data).toMatchObject({
      id: created.body.data.id,
      versionNo: 1,
      diagnosisId: null,
      subtotal: 2500,
      discount: 100,
      total: 2400,
      customerNote: "Revised quote",
      expiresAt: null,
      items: [expect.objectContaining({ approvalGroup: null, lineTotal: 2500 })],
    });
    const newItemIds = updated.body.data.items.map((item: { id: string }) => item.id);
    expect(newItemIds).not.toEqual(oldItemIds);
    expect(await prisma.quoteItem.count({ where: { id: { in: oldItemIds } } })).toBe(0);
    expect(
      await prisma.orderEvent.count({
        where: { repairOrderId: orderId, eventType: "QUOTE_DRAFT_UPDATED" },
      }),
    ).toBe(1);
  });

  it("enforces role, membership, tenant, and quote-eligible state boundaries", async () => {
    const orderId = await createOrder();
    const technician = await createRequest(orderId, fixture.technicianToken)
      .send(payload())
      .expect(403);
    expect(technician.body.error.code).toBe("PERMISSION_DENIED");
    await createRequest(orderId, fixture.inactiveReceptionistToken).send(payload()).expect(403);

    const editable = await createRequest(orderId).send(payload()).expect(201);
    await replaceRequest(editable.body.data.id, fixture.technicianToken)
      .send(payload())
      .expect(403);

    const crossTenantOrder = await createOrder({ shop: "B" });
    const crossTenant = await createRequest(crossTenantOrder).send(payload()).expect(404);
    expect(crossTenant.body.error.code).toBe("RESOURCE_NOT_FOUND");
    const foreignQuote = await prisma.quoteVersion.create({
      data: {
        shopId: fixture.shopBId,
        repairOrderId: crossTenantOrder,
        versionNo: 1,
        createdByUserId: fixture.ownerBId,
      },
    });
    const crossTenantUpdate = await replaceRequest(foreignQuote.id).send(payload()).expect(404);
    expect(crossTenantUpdate.body.error.code).toBe("RESOURCE_NOT_FOUND");

    const wrongStateOrder = await createOrder({ status: RepairOrderStatus.RECEIVED });
    const wrongState = await createRequest(wrongStateOrder).send(payload()).expect(409);
    expect(wrongState.body.error.code).toBe("REPAIR_ORDER_GUARD_FAILED");

    const repairingOrder = await createOrder({ status: RepairOrderStatus.REPAIRING });
    await createRequest(repairingOrder, fixture.receptionistToken).send(payload()).expect(201);
  });

  it("requires diagnosis references to belong to the same order and shop", async () => {
    const sourceOrder = await createOrder();
    const sourceDiagnosis = await createDiagnosis(sourceOrder);
    const targetOrder = await createOrder();
    const mismatched = await createRequest(targetOrder).send(payload(sourceDiagnosis)).expect(404);
    expect(mismatched.body.error.code).toBe("RESOURCE_NOT_FOUND");

    const foreignOrder = await createOrder({ shop: "B" });
    const foreignDiagnosis = await createDiagnosis(foreignOrder, "B");
    const foreign = await createRequest(targetOrder).send(payload(foreignDiagnosis)).expect(404);
    expect(foreign.body.error.code).toBe("RESOURCE_NOT_FOUND");
    expect(await prisma.quoteVersion.count({ where: { repairOrderId: targetOrder } })).toBe(0);
  });

  it("rejects invalid items, groups, client-owned fields, unsafe money, and credentials", async () => {
    const orderId = await createOrder();
    const empty = await createRequest(orderId)
      .send({ ...payload(), items: [] })
      .expect(422);
    expect(empty.body.error.code).toBe("QUOTE_ITEMS_REQUIRED");

    const groupedRequired = await createRequest(orderId)
      .send({
        ...payload(),
        items: [{ ...payload().items[0], approvalGroup: "required-group" }],
      })
      .expect(422);
    expect(groupedRequired.body.error.code).toBe("QUOTE_APPROVAL_GROUP_INVALID");

    const excessiveDiscount = await createRequest(orderId)
      .send({ ...payload(), items: [payload().items[0]], discount: 2000 })
      .expect(422);
    expect(excessiveDiscount.body.error.details).toContainEqual(
      expect.objectContaining({ code: "DISCOUNT_EXCEEDS_SUBTOTAL" }),
    );

    await createRequest(orderId)
      .send({ ...payload(), items: [{ ...payload().items[0], quantity: 1.001 }] })
      .expect(422);
    await createRequest(orderId)
      .send({ ...payload(), items: [{ ...payload().items[0], unitPrice: -1 }] })
      .expect(422);
    await createRequest(orderId)
      .send({ ...payload(), expiresAt: "2020-01-01T00:00:00.000Z" })
      .expect(422);
    await createRequest(orderId)
      .send({ ...payload(), status: QuoteStatus.SENT, subtotal: 1, versionNo: 99 })
      .expect(422);

    const tooLarge = await createRequest(orderId)
      .send({
        ...payload(),
        discount: 0,
        items: [{ ...payload().items[0], quantity: 2, unitPrice: Number.MAX_SAFE_INTEGER }],
      })
      .expect(422);
    expect(tooLarge.body.error.details).toContainEqual(
      expect.objectContaining({ code: "MONEY_OUT_OF_RANGE" }),
    );

    const secret = await createRequest(orderId)
      .send({ ...payload(), customerNote: "Device PIN: 1234" })
      .expect(422);
    expect(secret.body.error.details).toContainEqual(
      expect.objectContaining({ code: "DEVICE_CREDENTIAL_NOT_ALLOWED" }),
    );
    expect(await prisma.quoteVersion.count({ where: { repairOrderId: orderId } })).toBe(0);
  });

  it("keeps sent and terminal quote versions immutable", async () => {
    const orderId = await createOrder();
    for (const [index, status] of [
      QuoteStatus.SENT,
      QuoteStatus.ACCEPTED,
      QuoteStatus.PARTIALLY_ACCEPTED,
      QuoteStatus.DECLINED,
      QuoteStatus.EXPIRED,
      QuoteStatus.SUPERSEDED,
    ].entries()) {
      const quote = await prisma.quoteVersion.create({
        data: {
          shopId: fixture.shopAId,
          repairOrderId: orderId,
          versionNo: index + 1,
          status,
          createdByUserId: fixture.ownerAId,
          subtotal: 100n,
          total: 100n,
          items: {
            create: {
              kind: QuoteItemKind.SERVICE,
              description: `Immutable ${status}`,
              quantity: 1,
              unitPrice: 100n,
              lineTotal: 100n,
            },
          },
        },
      });
      const response = await replaceRequest(quote.id).send(payload()).expect(409);
      expect(response.body.error.code).toBe("QUOTE_IMMUTABLE");
    }
    expect(
      await prisma.quoteItem.count({ where: { quoteVersion: { repairOrderId: orderId } } }),
    ).toBe(6);
  });

  it("allocates unique sequential versions under concurrent create requests", async () => {
    const orderId = await createOrder();
    const [first, second] = await Promise.all([
      createRequest(orderId).send(payload()),
      createRequest(orderId, fixture.receptionistToken).send(payload()),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const versions = await prisma.quoteVersion.findMany({
      where: { repairOrderId: orderId },
      orderBy: { versionNo: "asc" },
      select: { versionNo: true, items: { select: { id: true } } },
    });
    expect(versions.map((entry) => entry.versionNo)).toEqual([1, 2]);
    expect(versions.every((entry) => entry.items.length === 2)).toBe(true);
  });

  it("rolls back draft replacement when item persistence fails", async () => {
    const orderId = await createOrder();
    const created = await createRequest(orderId).send(payload()).expect(201);
    const before = await prisma.quoteVersion.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    const functionName = `rf035_fail_item_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const triggerName = `${functionName}_trigger`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."description" = 'RF035_FORCE_ROLLBACK' THEN
          RAISE EXCEPTION 'forced RF-035 item failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "quote_items"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);

    try {
      await replaceRequest(created.body.data.id)
        .send({
          ...payload(),
          items: [{ ...payload().items[0], description: "RF035_FORCE_ROLLBACK" }],
        })
        .expect(500);
      const after = await prisma.quoteVersion.findUniqueOrThrow({
        where: { id: created.body.data.id },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
      expect(after).toMatchObject({
        subtotal: before.subtotal,
        discount: before.discount,
        total: before.total,
        customerNote: before.customerNote,
      });
      expect(after.items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
      expect(
        await prisma.orderEvent.count({
          where: { repairOrderId: orderId, eventType: "QUOTE_DRAFT_UPDATED" },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "quote_items";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  });
});
