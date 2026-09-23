import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  DeviceType,
  MembershipRole,
  MembershipStatus,
  PartRequirementStatus,
  QuoteDecision,
  QuoteItemKind,
  QuoteQuantityUnit,
  QuoteStatus,
  RepairOrderStatus,
  WorkLogType,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";
import { TokenService } from "../src/common/auth/token.service.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";

interface Fixture {
  shopId: string;
  branchId: string;
  customerId: string;
  deviceId: string;
  ownerId: string;
  ownerToken: string;
}

interface BindingItem {
  id: string;
  scopeKey: string;
  kind: QuoteItemKind;
  description: string;
  quantity: number;
  quantityUnit: QuoteQuantityUnit;
  unitPrice: number;
  isOptional: boolean;
  approvalGroup: string | null;
}

describe("RF-041 replacement quote lineage", () => {
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
    const suffix = randomUUID().slice(0, 8);
    const shop = await prisma.shop.create({
      data: { name: `Lineage ${suffix}`, slug: `lineage-${suffix}` },
    });
    const branch = await prisma.branch.create({
      data: { shopId: shop.id, name: "Lineage Main" },
    });
    const customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        name: "Lineage Customer",
        phoneRaw: "0900000410",
        phoneNormalized: "+84900000410",
      },
    });
    const device = await prisma.device.create({
      data: {
        shopId: shop.id,
        customerId: customer.id,
        type: DeviceType.PHONE,
        brand: "Lineage",
        model: "Device",
      },
    });
    const owner = await prisma.user.create({
      data: {
        email: `rf041-${suffix}@example.com`,
        passwordHash: "test-only",
        displayName: "Lineage Owner",
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
      ownerToken: moduleRef.get(TokenService).createAccessToken(owner.id).token,
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
    await prisma.auditLog.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.partUsed.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.partRequirement.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.workLog.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.quoteApproval.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.quoteItem.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.quoteVersion.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.orderEvent.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.assignment.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.repairOrder.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.device.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.customer.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.shopMembership.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.branch.deleteMany({ where: { shopId: fixture.shopId } });
    await prisma.shop.delete({ where: { id: fixture.shopId } });
    await prisma.user.delete({ where: { id: fixture.ownerId } });
    await app.close();
  });

  async function createRepairingOrder(): Promise<string> {
    const orderNo = nextOrderNo++;
    const order = await prisma.repairOrder.create({
      data: {
        shopId: fixture.shopId,
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        deviceId: fixture.deviceId,
        orderNo,
        code: `LINEAGE-${orderNo}`,
        status: RepairOrderStatus.REPAIRING,
        reportedProblem: "Replacement quote test",
        intakeCondition: "Used condition",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "Lineage Customer", phone: "+84900000410" },
        deviceSnapshot: { type: DeviceType.PHONE, brand: "Lineage", model: "Device" },
        createdByUserId: fixture.ownerId,
      },
    });
    return order.id;
  }

  async function createBinding(repairOrderId: string): Promise<BindingItem[]> {
    const items: BindingItem[] = [
      {
        id: randomUUID(),
        scopeKey: randomUUID(),
        kind: QuoteItemKind.SERVICE,
        description: "Replace charging controller",
        quantity: 1,
        quantityUnit: QuoteQuantityUnit.HOUR,
        unitPrice: 300_000,
        isOptional: false,
        approvalGroup: null,
      },
      {
        id: randomUUID(),
        scopeKey: randomUUID(),
        kind: QuoteItemKind.PART,
        description: "Original controller",
        quantity: 1,
        quantityUnit: QuoteQuantityUnit.EACH,
        unitPrice: 200_000,
        isOptional: false,
        approvalGroup: null,
      },
    ];
    const quote = await prisma.quoteVersion.create({
      data: {
        shopId: fixture.shopId,
        repairOrderId,
        versionNo: 1,
        status: QuoteStatus.ACCEPTED,
        subtotal: 500_000n,
        total: 500_000n,
        sentAt: new Date(),
        decidedAt: new Date(),
        createdByUserId: fixture.ownerId,
        items: {
          create: items.map((item, sortOrder) => ({
            ...item,
            lineTotal: BigInt(item.unitPrice * item.quantity),
            sortOrder,
          })),
        },
      },
    });
    await prisma.quoteApproval.create({
      data: {
        shopId: fixture.shopId,
        quoteVersionId: quote.id,
        decision: QuoteDecision.ACCEPTED,
        approvedItemSnapshot: items.map((item) => ({
          ...item,
          carriedFromQuoteItemId: null,
          displayNote: null,
          lineTotal: item.unitPrice * item.quantity,
        })) as Prisma.InputJsonValue,
        approvedTotal: 500_000n,
        idempotencyKeyHash: randomUUID(),
      },
    });
    return items;
  }

  function draftRequest(repairOrderId: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${repairOrderId}/quotes`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .set("X-Shop-Id", fixture.shopId);
  }

  function sendRequest(quoteVersionId: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/quotes/${quoteVersionId}/send`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .set("X-Shop-Id", fixture.shopId)
      .set("Idempotency-Key", `rf041-send-${randomUUID()}`)
      .send({ channel: "COPY_LINK" });
  }

  function replaceRequest(quoteVersionId: string) {
    return request(app.getHttpServer())
      .patch(`/api/v1/quotes/${quoteVersionId}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .set("X-Shop-Id", fixture.shopId);
  }

  function replacementPayload(carried: BindingItem, overrides: Record<string, unknown> = {}) {
    return {
      discount: 0,
      customerNote: "Replacement quote",
      expiresAt: "2099-12-31T00:00:00.000Z",
      items: [
        {
          kind: carried.kind,
          description: carried.description,
          displayNote: "Price updated after inspection",
          carriedFromQuoteItemId: carried.id,
          quantity: carried.quantity,
          quantityUnit: carried.quantityUnit,
          unitPrice: carried.unitPrice + 50_000,
          isOptional: carried.isOptional,
          approvalGroup: carried.approvalGroup,
          ...overrides,
        },
        {
          kind: QuoteItemKind.PART,
          description: "New supporting part",
          displayNote: null,
          carriedFromQuoteItemId: null,
          quantity: 1,
          quantityUnit: QuoteQuantityUnit.EACH,
          unitPrice: 75_000,
          isOptional: false,
          approvalGroup: null,
        },
      ],
    };
  }

  it("carries valid scope through send and public decision, then cancels omitted part readiness", async () => {
    const orderId = await createRepairingOrder();
    const [service, omittedPart] = await createBinding(orderId);
    await prisma.workLog.create({
      data: {
        shopId: fixture.shopId,
        repairOrderId: orderId,
        quoteItemId: service!.id,
        type: WorkLogType.REPAIR,
        content: "Existing approved work",
        createdByUserId: fixture.ownerId,
      },
    });
    await prisma.partRequirement.create({
      data: {
        shopId: fixture.shopId,
        repairOrderId: orderId,
        quoteItemId: omittedPart!.id,
        scopeKey: omittedPart!.scopeKey,
        nameSnapshot: omittedPart!.description,
        quantity: 1,
        quantityUnit: QuoteQuantityUnit.EACH,
        status: PartRequirementStatus.AVAILABLE,
        createdByUserId: fixture.ownerId,
        updatedByUserId: fixture.ownerId,
      },
    });

    const draft = await draftRequest(orderId)
      .set("X-Request-Id", "rf041-valid-draft")
      .send(replacementPayload(service!))
      .expect(201);
    expect(draft.body.data.items[0]).toMatchObject({
      scopeKey: service!.scopeKey,
      carriedFromQuoteItemId: service!.id,
      displayNote: "Price updated after inspection",
      quantityUnit: QuoteQuantityUnit.HOUR,
    });
    expect(draft.body.data.items[1].scopeKey).not.toBe(omittedPart!.scopeKey);

    const sent = await sendRequest(draft.body.data.id).expect(200);
    const rawToken = new URL(sent.body.data.publicUrl as string).pathname.split("/").at(-1)!;
    expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      status: RepairOrderStatus.AWAITING_APPROVAL,
      lockVersion: 1,
    });

    await request(app.getHttpServer())
      .post(`/public/v1/quotes/${rawToken}/decision`)
      .set("Idempotency-Key", `rf041-decision-${randomUUID()}`)
      .send({ decision: QuoteDecision.ACCEPTED, approvedItemIds: [] })
      .expect(200);

    const [replacement, requirement, order, work, audits] = await Promise.all([
      prisma.quoteVersion.findUniqueOrThrow({
        where: { id: draft.body.data.id as string },
        include: { approval: true, items: { orderBy: { sortOrder: "asc" } } },
      }),
      prisma.partRequirement.findFirstOrThrow({ where: { repairOrderId: orderId } }),
      prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.workLog.findFirstOrThrow({ where: { repairOrderId: orderId } }),
      prisma.auditLog.findMany({ where: { shopId: fixture.shopId, entityId: orderId } }),
    ]);
    expect(order).toMatchObject({ status: RepairOrderStatus.APPROVED, lockVersion: 2 });
    expect(requirement.status).toBe(PartRequirementStatus.CANCELLED);
    expect(work.quoteItemId).toBe(service!.id);
    expect(replacement.approval?.approvedItemSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: replacement.items[0]!.id, scopeKey: service!.scopeKey }),
      ]),
    );
    expect(audits.some((audit) => audit.action === "QUOTE_SCOPE_LINEAGE_ACCEPTED")).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(rawToken);
  });

  it("rejects changed or duplicate claimed lineage and leaves only redacted audit evidence", async () => {
    const orderId = await createRepairingOrder();
    const [service] = await createBinding(orderId);
    const invalidVariants: Array<Record<string, unknown>> = [
      { quantity: 2 },
      { description: "A semantically different repair" },
      { kind: QuoteItemKind.PART },
      { quantityUnit: QuoteQuantityUnit.EACH },
      { isOptional: true },
      { carriedFromQuoteItemId: randomUUID() },
    ];
    for (const [index, overrides] of invalidVariants.entries()) {
      const changed = await draftRequest(orderId)
        .set("X-Request-Id", `rf041-invalid-lineage-${index}`)
        .send(replacementPayload(service!, overrides))
        .expect(422);
      expect(changed.body.error.code).toBe("QUOTE_SCOPE_LINEAGE_INVALID");
    }

    const duplicatePayload = replacementPayload(service!);
    const duplicate = await draftRequest(orderId)
      .send({
        ...duplicatePayload,
        items: [duplicatePayload.items[0], duplicatePayload.items[0]],
      })
      .expect(422);
    expect(duplicate.body.error.code).toBe("QUOTE_SCOPE_LINEAGE_INVALID");

    expect(await prisma.quoteVersion.count({ where: { repairOrderId: orderId } })).toBe(1);
    expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      status: RepairOrderStatus.REPAIRING,
      lockVersion: 0,
    });
    const audits = await prisma.auditLog.findMany({
      where: { shopId: fixture.shopId, action: "QUOTE_SCOPE_LINEAGE_REJECTED" },
    });
    expect(audits.length).toBeGreaterThanOrEqual(invalidVariants.length + 1);
    expect(JSON.stringify(audits)).not.toContain(service!.description);
    expect(JSON.stringify(audits)).not.toContain(service!.id);
  });

  it("rejects display-note-only replacement and corrupted lineage without partial writes", async () => {
    const noteOnlyOrder = await createRepairingOrder();
    const [noteOnlyService, noteOnlyPart] = await createBinding(noteOnlyOrder);
    const noteOnlyPayload = replacementPayload(noteOnlyService!, {
      unitPrice: noteOnlyService!.unitPrice,
    });
    const noteOnlyDraft = await draftRequest(noteOnlyOrder)
      .send({
        ...noteOnlyPayload,
        items: [
          noteOnlyPayload.items[0],
          {
            kind: noteOnlyPart!.kind,
            description: noteOnlyPart!.description,
            displayNote: "Only this note changed",
            carriedFromQuoteItemId: noteOnlyPart!.id,
            quantity: noteOnlyPart!.quantity,
            quantityUnit: noteOnlyPart!.quantityUnit,
            unitPrice: noteOnlyPart!.unitPrice,
            isOptional: noteOnlyPart!.isOptional,
            approvalGroup: noteOnlyPart!.approvalGroup,
          },
        ],
      })
      .expect(201);
    expect((await sendRequest(noteOnlyDraft.body.data.id).expect(409)).body.error.code).toBe(
      "REPAIR_ORDER_GUARD_FAILED",
    );
    expect(await prisma.publicAccessToken.count({ where: { repairOrderId: noteOnlyOrder } })).toBe(
      0,
    );

    const prematureWorkOrder = await createRepairingOrder();
    const [prematureService] = await createBinding(prematureWorkOrder);
    const prematureDraft = await draftRequest(prematureWorkOrder)
      .send(replacementPayload(prematureService!))
      .expect(201);
    await prisma.workLog.create({
      data: {
        shopId: fixture.shopId,
        repairOrderId: prematureWorkOrder,
        quoteItemId: prematureDraft.body.data.items[1].id as string,
        type: WorkLogType.REPAIR,
        content: "Invalid premature execution",
        createdByUserId: fixture.ownerId,
      },
    });
    expect((await sendRequest(prematureDraft.body.data.id).expect(409)).body.error.code).toBe(
      "REPAIR_ORDER_GUARD_FAILED",
    );
    expect(
      await prisma.repairOrder.findUniqueOrThrow({ where: { id: prematureWorkOrder } }),
    ).toMatchObject({ status: RepairOrderStatus.REPAIRING, lockVersion: 0 });

    const corruptedOrder = await createRepairingOrder();
    const [service, other] = await createBinding(corruptedOrder);
    const corruptedDraft = await draftRequest(corruptedOrder)
      .send(replacementPayload(service!))
      .expect(201);
    const sent = await sendRequest(corruptedDraft.body.data.id).expect(200);
    const rawToken = new URL(sent.body.data.publicUrl as string).pathname.split("/").at(-1)!;
    await prisma.quoteItem.update({
      where: { id: corruptedDraft.body.data.items[0].id as string },
      data: { carriedFromQuoteItemId: other!.id },
    });

    const decisionKey = `rf041-corrupt-${randomUUID()}`;
    const rejected = await request(app.getHttpServer())
      .post(`/public/v1/quotes/${rawToken}/decision`)
      .set("Idempotency-Key", decisionKey)
      .send({ decision: QuoteDecision.ACCEPTED, approvedItemIds: [] })
      .expect(422);
    expect(rejected.body.error.code).toBe("QUOTE_SCOPE_LINEAGE_INVALID");
    expect(
      await prisma.quoteApproval.count({ where: { quoteVersionId: corruptedDraft.body.data.id } }),
    ).toBe(0);
    expect(
      await prisma.idempotencyRecord.count({
        where: { shopId: fixture.shopId, scope: "public.quote-decision" },
      }),
    ).toBe(1);
    expect(
      await prisma.repairOrder.findUniqueOrThrow({ where: { id: corruptedOrder } }),
    ).toMatchObject({ status: RepairOrderStatus.AWAITING_APPROVAL, lockVersion: 1 });
    expect(
      await prisma.auditLog.count({
        where: {
          shopId: fixture.shopId,
          entityId: corruptedOrder,
          action: "QUOTE_SCOPE_LINEAGE_REJECTED",
        },
      }),
    ).toBe(1);
  });

  it("rolls back an invalid draft replacement and audits against the repair order", async () => {
    const orderId = await createRepairingOrder();
    const [service] = await createBinding(orderId);
    const draft = await draftRequest(orderId).send(replacementPayload(service!)).expect(201);
    const before = await prisma.quoteVersion.findUniqueOrThrow({
      where: { id: draft.body.data.id as string },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    const rejected = await replaceRequest(draft.body.data.id)
      .set("X-Request-Id", "rf041-invalid-replace")
      .send(replacementPayload(service!, { description: "Changed binding meaning" }))
      .expect(422);
    expect(rejected.body.error.code).toBe("QUOTE_SCOPE_LINEAGE_INVALID");

    const after = await prisma.quoteVersion.findUniqueOrThrow({
      where: { id: draft.body.data.id as string },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    expect(after.items.map((item) => item.id)).toEqual(before.items.map((item) => item.id));
    expect(after.total).toBe(before.total);
    expect(
      await prisma.auditLog.count({
        where: {
          shopId: fixture.shopId,
          entityId: orderId,
          action: "QUOTE_SCOPE_LINEAGE_REJECTED",
          requestId: "rf041-invalid-replace",
        },
      }),
    ).toBe(1);
  });
});
