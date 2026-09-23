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
  ownerId: string;
  technicianId: string;
  otherTechnicianId: string;
  ownerBId: string;
  ownerToken: string;
  receptionistToken: string;
  technicianToken: string;
  otherTechnicianToken: string;
  inactiveToken: string;
  ownerBToken: string;
  userIds: string[];
}

interface ApprovedOrder {
  orderId: string;
  quoteId: string;
  serviceItemId: string;
  serviceScopeKey: string;
  partItemId: string;
  partScopeKey: string;
  excludedItemId: string | null;
}

describe("approved-scope work logs and parts API", () => {
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
    const tokens = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);

    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({
        data: { name: `Execution A ${suffix}`, slug: `execution-a-${suffix}` },
      }),
      prisma.shop.create({
        data: { name: `Execution B ${suffix}`, slug: `execution-b-${suffix}` },
      }),
    ]);
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopA.id, name: "Main A" } }),
      prisma.branch.create({ data: { shopId: shopB.id, name: "Main B" } }),
    ]);
    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "Execution Customer A",
          phoneRaw: "0900000842",
          phoneNormalized: "+84900000842",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "Execution Customer B",
          phoneRaw: "0900001842",
          phoneNormalized: "+84900001842",
        },
      }),
    ]);
    const [deviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopA.id,
          customerId: customerA.id,
          type: DeviceType.PHONE,
          brand: "RepairFlow",
          model: "A",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopB.id,
          customerId: customerB.id,
          type: DeviceType.LAPTOP,
          brand: "RepairFlow",
          model: "B",
        },
      }),
    ]);
    const userSpecs = [
      ["Owner A", MembershipRole.OWNER, shopA.id, MembershipStatus.ACTIVE],
      ["Receptionist A", MembershipRole.RECEPTIONIST, shopA.id, MembershipStatus.ACTIVE],
      ["Technician A", MembershipRole.TECHNICIAN, shopA.id, MembershipStatus.ACTIVE],
      ["Technician Other", MembershipRole.TECHNICIAN, shopA.id, MembershipStatus.ACTIVE],
      ["Technician Inactive", MembershipRole.TECHNICIAN, shopA.id, MembershipStatus.INACTIVE],
      ["Owner B", MembershipRole.OWNER, shopB.id, MembershipStatus.ACTIVE],
    ] as const;
    const users = await Promise.all(
      userSpecs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `execution-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    await prisma.shopMembership.createMany({
      data: userSpecs.map(([, role, shopId, status], index) => ({
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
      ownerId: users[0]!.id,
      technicianId: users[2]!.id,
      otherTechnicianId: users[3]!.id,
      ownerBId: users[5]!.id,
      ownerToken: tokens.createAccessToken(users[0]!.id).token,
      receptionistToken: tokens.createAccessToken(users[1]!.id).token,
      technicianToken: tokens.createAccessToken(users[2]!.id).token,
      otherTechnicianToken: tokens.createAccessToken(users[3]!.id).token,
      inactiveToken: tokens.createAccessToken(users[4]!.id).token,
      ownerBToken: tokens.createAccessToken(users[5]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.partUsed.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.partRequirement.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.workLog.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteApproval.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteItem.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteVersion.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.assignment.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await app.close();
  });

  async function createApprovedOrder(options?: {
    shop?: "A" | "B";
    status?: RepairOrderStatus;
    assigned?: boolean;
    partial?: boolean;
  }): Promise<ApprovedOrder> {
    const inShopA = options?.shop !== "B";
    const shopId = inShopA ? fixture.shopAId : fixture.shopBId;
    const branchId = inShopA ? fixture.branchAId : fixture.branchBId;
    const customerId = inShopA ? fixture.customerAId : fixture.customerBId;
    const deviceId = inShopA ? fixture.deviceAId : fixture.deviceBId;
    const actorId = inShopA ? fixture.ownerId : fixture.ownerBId;
    const orderNo = nextOrderNo++;
    const order = await prisma.repairOrder.create({
      data: {
        shopId,
        branchId,
        customerId,
        deviceId,
        orderNo,
        code: `EXEC-${inShopA ? "A" : "B"}-${orderNo}`,
        status: options?.status ?? RepairOrderStatus.REPAIRING,
        reportedProblem: "Execution test",
        intakeCondition: "Received intact",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "Snapshot customer", phone: "0900000000" },
        deviceSnapshot: { type: DeviceType.PHONE, brand: "Snapshot", model: "Device" },
        createdByUserId: actorId,
      },
    });
    if (inShopA && options?.assigned !== false) {
      await prisma.assignment.create({
        data: {
          shopId,
          repairOrderId: order.id,
          technicianUserId: fixture.technicianId,
          assignedByUserId: fixture.ownerId,
        },
      });
    }
    const quote = await prisma.quoteVersion.create({
      data: {
        shopId,
        repairOrderId: order.id,
        versionNo: 1,
        status: options?.partial ? QuoteStatus.PARTIALLY_ACCEPTED : QuoteStatus.ACCEPTED,
        subtotal: 800_000n,
        total: 800_000n,
        createdByUserId: actorId,
        items: {
          create: [
            {
              kind: QuoteItemKind.SERVICE,
              description: "Repair service",
              quantity: "1.00",
              quantityUnit: QuoteQuantityUnit.HOUR,
              unitPrice: 300_000n,
              lineTotal: 300_000n,
              sortOrder: 1,
            },
            {
              kind: QuoteItemKind.PART,
              description: "Replacement part",
              quantity: "2.00",
              quantityUnit: QuoteQuantityUnit.EACH,
              unitPrice: 250_000n,
              lineTotal: 500_000n,
              sortOrder: 2,
            },
            ...(options?.partial
              ? [
                  {
                    kind: QuoteItemKind.SERVICE,
                    description: "Optional cleaning",
                    quantity: "1.00",
                    quantityUnit: QuoteQuantityUnit.HOUR,
                    unitPrice: 100_000n,
                    lineTotal: 100_000n,
                    isOptional: true,
                    sortOrder: 3,
                  },
                ]
              : []),
          ],
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    const selected = quote.items.slice(0, 2);
    await prisma.quoteApproval.create({
      data: {
        shopId,
        quoteVersionId: quote.id,
        decision: options?.partial ? QuoteDecision.PARTIALLY_ACCEPTED : QuoteDecision.ACCEPTED,
        approvedItemSnapshot: selected.map((item) => ({
          id: item.id,
          scopeKey: item.scopeKey,
          carriedFromQuoteItemId: item.carriedFromQuoteItemId,
          kind: item.kind,
          description: item.description,
          displayNote: item.displayNote,
          quantity: Number(item.quantity.toString()),
          quantityUnit: item.quantityUnit,
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal),
          isOptional: item.isOptional,
          approvalGroup: item.approvalGroup,
        })),
        approvedTotal: 800_000n,
        idempotencyKeyHash: randomUUID(),
      },
    });
    return {
      orderId: order.id,
      quoteId: quote.id,
      serviceItemId: quote.items[0]!.id,
      serviceScopeKey: quote.items[0]!.scopeKey,
      partItemId: quote.items[1]!.id,
      partScopeKey: quote.items[1]!.scopeKey,
      excludedItemId: quote.items[2]?.id ?? null,
    };
  }

  function postWorkLog(
    orderId: string,
    body: object,
    options?: { token?: string; shopId?: string; key?: string },
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/work-logs`)
      .set("Authorization", `Bearer ${options?.token ?? fixture.ownerToken}`)
      .set("X-Shop-Id", options?.shopId ?? fixture.shopAId)
      .set("Idempotency-Key", options?.key ?? `work-log-${randomUUID()}`)
      .send(body);
  }

  function postRequirement(
    orderId: string,
    body: object,
    options?: { token?: string; shopId?: string; key?: string },
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/part-requirements`)
      .set("Authorization", `Bearer ${options?.token ?? fixture.ownerToken}`)
      .set("X-Shop-Id", options?.shopId ?? fixture.shopAId)
      .set("Idempotency-Key", options?.key ?? `requirement-${randomUUID()}`)
      .send(body);
  }

  function patchRequirement(
    requirementId: string,
    body: object,
    options?: { token?: string; shopId?: string; key?: string },
  ) {
    return request(app.getHttpServer())
      .patch(`/api/v1/part-requirements/${requirementId}`)
      .set("Authorization", `Bearer ${options?.token ?? fixture.ownerToken}`)
      .set("X-Shop-Id", options?.shopId ?? fixture.shopAId)
      .set("Idempotency-Key", options?.key ?? `requirement-update-${randomUUID()}`)
      .send(body);
  }

  function postPartUsed(
    orderId: string,
    body: object,
    options?: { token?: string; shopId?: string; key?: string },
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/parts-used`)
      .set("Authorization", `Bearer ${options?.token ?? fixture.ownerToken}`)
      .set("X-Shop-Id", options?.shopId ?? fixture.shopAId)
      .set("Idempotency-Key", options?.key ?? `part-used-${randomUUID()}`)
      .send(body);
  }

  it("records technical, operational, and corrected logs as ordered immutable evidence", async () => {
    const approved = await createApprovedOrder();
    const repair = await postWorkLog(approved.orderId, {
      type: WorkLogType.REPAIR,
      content: "Replaced damaged component",
      quoteItemId: approved.serviceItemId,
    }).expect(201);
    const note = await postWorkLog(approved.orderId, {
      type: WorkLogType.INTERNAL_NOTE,
      content: "Internal diagnostic detail",
    }).expect(201);
    const correction = await postWorkLog(approved.orderId, {
      type: WorkLogType.CORRECTION,
      content: "Replaced and recalibrated component",
      supersedesId: repair.body.data.id,
    }).expect(201);

    expect(correction.body.data).toMatchObject({
      type: WorkLogType.CORRECTION,
      effectiveType: WorkLogType.REPAIR,
      quoteItemId: approved.serviceItemId,
      scopeKey: approved.serviceScopeKey,
      supersedesId: repair.body.data.id,
      isEffective: true,
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/repair-orders/${approved.orderId}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(200);
    expect(detail.body.data.approvedScope.items).toHaveLength(2);
    expect(detail.body.data.workLogs.map((entry: { id: string }) => entry.id)).toEqual([
      repair.body.data.id,
      note.body.data.id,
      correction.body.data.id,
    ]);
    expect(detail.body.data.workLogs[0].isEffective).toBe(false);
    const internalEvent = await prisma.orderEvent.findFirstOrThrow({
      where: {
        repairOrderId: approved.orderId,
        privatePayload: { path: ["workLogId"], equals: note.body.data.id },
      },
    });
    expect(internalEvent.publicPayload).toBeNull();
  });

  it("enforces role, assignment, inactive membership, and tenant boundaries", async () => {
    const approved = await createApprovedOrder();
    await postWorkLog(
      approved.orderId,
      {
        type: WorkLogType.TEST,
        content: "Assigned technician test",
        quoteItemId: approved.serviceItemId,
      },
      { token: fixture.technicianToken },
    ).expect(201);
    await postWorkLog(
      approved.orderId,
      { type: WorkLogType.TEST, content: "Receptionist", quoteItemId: approved.serviceItemId },
      { token: fixture.receptionistToken },
    ).expect(403);
    await postWorkLog(
      approved.orderId,
      { type: WorkLogType.TEST, content: "Unassigned", quoteItemId: approved.serviceItemId },
      { token: fixture.otherTechnicianToken },
    ).expect(404);
    await postWorkLog(
      approved.orderId,
      { type: WorkLogType.TEST, content: "Inactive", quoteItemId: approved.serviceItemId },
      { token: fixture.inactiveToken },
    ).expect(403);

    const foreign = await createApprovedOrder({ shop: "B" });
    await postWorkLog(foreign.orderId, {
      type: WorkLogType.REPAIR,
      content: "Cross tenant",
      quoteItemId: foreign.serviceItemId,
    }).expect(404);
  });

  it("applies the state matrix and rejects all execution writes while approval is pending", async () => {
    const approved = await createApprovedOrder({ status: RepairOrderStatus.APPROVED });
    await postWorkLog(approved.orderId, {
      type: WorkLogType.CUSTOMER_CONTACT,
      content: "Customer informed",
    }).expect(201);
    await postWorkLog(approved.orderId, {
      type: WorkLogType.REPAIR,
      content: "Too early",
      quoteItemId: approved.serviceItemId,
    }).expect(409);
    await postPartUsed(approved.orderId, {
      quoteItemId: approved.partItemId,
      name: "Too early",
      quantity: 1,
    }).expect(409);
    await postRequirement(approved.orderId, { quoteItemId: approved.partItemId }).expect(201);

    await prisma.repairOrder.update({
      where: { id: approved.orderId },
      data: { status: RepairOrderStatus.AWAITING_APPROVAL },
    });
    await postWorkLog(approved.orderId, {
      type: WorkLogType.INTERNAL_NOTE,
      content: "Pending approval",
    }).expect(409);
    await postRequirement(approved.orderId, { quoteItemId: approved.partItemId }).expect(409);
    await postPartUsed(approved.orderId, {
      quoteItemId: approved.partItemId,
      name: "Pending approval",
      quantity: 1,
    }).expect(409);
  });

  it("allows operational notes in an allowed state without inventing approved scope", async () => {
    const orderNo = nextOrderNo++;
    const order = await prisma.repairOrder.create({
      data: {
        shopId: fixture.shopAId,
        branchId: fixture.branchAId,
        customerId: fixture.customerAId,
        deviceId: fixture.deviceAId,
        orderNo,
        code: `EXEC-A-${orderNo}`,
        status: RepairOrderStatus.READY_FOR_PICKUP,
        reportedProblem: "No repair outcome",
        intakeCondition: "Received intact",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "Snapshot customer", phone: "0900000000" },
        deviceSnapshot: { type: DeviceType.PHONE, brand: "Snapshot", model: "Device" },
        createdByUserId: fixture.ownerId,
      },
    });
    const note = await postWorkLog(order.id, {
      type: WorkLogType.CUSTOMER_CONTACT,
      content: "Customer notified that the device is ready",
    }).expect(201);
    expect(note.body.data).toMatchObject({ quoteItemId: null, scopeKey: null });
  });

  it("uses only selected current approval items and preserves stable lineage for corrections", async () => {
    const approved = await createApprovedOrder({ partial: true });
    await postWorkLog(approved.orderId, {
      type: WorkLogType.REPAIR,
      content: "Unselected optional work",
      quoteItemId: approved.excludedItemId,
    })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("APPROVED_ITEM_REQUIRED"));

    const initial = await postWorkLog(approved.orderId, {
      type: WorkLogType.REPAIR,
      content: "Original approved work",
      quoteItemId: approved.serviceItemId,
    }).expect(201);
    const replacement = await prisma.quoteVersion.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: approved.orderId,
        versionNo: 2,
        status: QuoteStatus.ACCEPTED,
        subtotal: 300_000n,
        total: 300_000n,
        createdByUserId: fixture.ownerId,
        items: {
          create: {
            scopeKey: approved.serviceScopeKey,
            carriedFromQuoteItemId: approved.serviceItemId,
            kind: QuoteItemKind.SERVICE,
            description: "Repair service",
            quantity: "1.00",
            quantityUnit: QuoteQuantityUnit.HOUR,
            unitPrice: 300_000n,
            lineTotal: 300_000n,
          },
        },
      },
      include: { items: true },
    });
    const replacementItem = replacement.items[0]!;
    await prisma.quoteApproval.create({
      data: {
        shopId: fixture.shopAId,
        quoteVersionId: replacement.id,
        decision: QuoteDecision.ACCEPTED,
        approvedItemSnapshot: [
          {
            id: replacementItem.id,
            scopeKey: replacementItem.scopeKey,
            carriedFromQuoteItemId: replacementItem.carriedFromQuoteItemId,
            kind: replacementItem.kind,
            description: replacementItem.description,
            displayNote: null,
            quantity: 1,
            quantityUnit: replacementItem.quantityUnit,
            unitPrice: 300_000,
            lineTotal: 300_000,
            isOptional: false,
            approvalGroup: null,
          },
        ],
        approvedTotal: 300_000n,
        idempotencyKeyHash: randomUUID(),
      },
    });
    const correction = await postWorkLog(approved.orderId, {
      type: WorkLogType.CORRECTION,
      content: "Corrected carried work",
      supersedesId: initial.body.data.id,
    }).expect(201);
    expect(correction.body.data.scopeKey).toBe(approved.serviceScopeKey);
    expect(correction.body.data.quoteItemId).toBe(approved.serviceItemId);
  });

  it("rejects missing, cross-order, and non-leaf work-log correction targets", async () => {
    const first = await createApprovedOrder();
    const second = await createApprovedOrder();
    const root = await postWorkLog(first.orderId, {
      type: WorkLogType.REPAIR,
      content: "Root",
      quoteItemId: first.serviceItemId,
    }).expect(201);
    const child = await postWorkLog(first.orderId, {
      type: WorkLogType.CORRECTION,
      content: "Child",
      supersedesId: root.body.data.id,
    }).expect(201);
    await postWorkLog(first.orderId, {
      type: WorkLogType.CORRECTION,
      content: "Branch",
      supersedesId: root.body.data.id,
    })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("WORK_LOG_CORRECTION_INVALID"));
    await postWorkLog(second.orderId, {
      type: WorkLogType.CORRECTION,
      content: "Cross-order",
      supersedesId: child.body.data.id,
    }).expect(404);
    await postWorkLog(first.orderId, {
      type: WorkLogType.CORRECTION,
      content: "Missing target",
    })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("WORK_LOG_CORRECTION_INVALID"));
  });

  it("enforces requirement lifecycle, idempotency, stale versions, and concurrent updates", async () => {
    const approved = await createApprovedOrder({ status: RepairOrderStatus.APPROVED });
    const key = `requirement-replay-${randomUUID()}`;
    const created = await postRequirement(
      approved.orderId,
      { quoteItemId: approved.partItemId, sku: "SKU-42" },
      { key },
    ).expect(201);
    const replay = await postRequirement(
      approved.orderId,
      { quoteItemId: approved.partItemId, sku: "SKU-42" },
      { key },
    ).expect(201);
    expect(replay.body).toEqual(created.body);
    await postRequirement(
      approved.orderId,
      { quoteItemId: approved.partItemId, sku: "DIFFERENT" },
      { key },
    )
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("IDEMPOTENCY_KEY_REUSED"));

    const requirementId = created.body.data.id as string;
    const results = await Promise.all([
      patchRequirement(requirementId, {
        targetStatus: PartRequirementStatus.ORDERED,
        expectedLockVersion: 0,
      }),
      patchRequirement(requirementId, {
        targetStatus: PartRequirementStatus.AVAILABLE,
        expectedLockVersion: 0,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const current = await prisma.partRequirement.findUniqueOrThrow({
      where: { id: requirementId },
    });
    if (current.status === PartRequirementStatus.ORDERED) {
      await patchRequirement(requirementId, {
        targetStatus: PartRequirementStatus.AVAILABLE,
        expectedLockVersion: current.lockVersion,
      }).expect(200);
    }
    await patchRequirement(requirementId, {
      targetStatus: PartRequirementStatus.ORDERED,
      expectedLockVersion: 0,
    }).expect(409);

    await prisma.partRequirement.update({
      where: { id: requirementId },
      data: { status: PartRequirementStatus.CANCELLED },
    });
    await patchRequirement(requirementId, {
      targetStatus: PartRequirementStatus.AVAILABLE,
      expectedLockVersion: 1,
    })
      .expect(409)
      .expect(({ body }) =>
        expect(["CONCURRENT_UPDATE", "PART_REQUIREMENT_INVALID_TRANSITION"]).toContain(
          body.error.code,
        ),
      );
  });

  it("replaces corrected used-part quantity and enforces approved cumulative quantity", async () => {
    const approved = await createApprovedOrder();
    await postPartUsed(approved.orderId, {
      quoteItemId: approved.partItemId,
      name: "Unapproved sale price",
      quantity: 1,
      unitSalePrice: 249_999,
    }).expect(409);
    const first = await postPartUsed(approved.orderId, {
      quoteItemId: approved.partItemId,
      name: "Part batch A",
      quantity: 1.5,
      unitCost: 100_000,
      unitSalePrice: 250_000,
    }).expect(201);
    await postPartUsed(approved.orderId, {
      quoteItemId: approved.partItemId,
      name: "Part batch overflow",
      quantity: 0.51,
    })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("PART_QUANTITY_EXCEEDED"));
    const correction = await postPartUsed(approved.orderId, {
      quoteItemId: approved.partItemId,
      name: "Corrected part batch A",
      quantity: 1,
      unitCost: 90_000,
      unitSalePrice: 250_000,
      supersedesId: first.body.data.id,
    }).expect(201);
    await postPartUsed(approved.orderId, {
      quoteItemId: approved.partItemId,
      name: "Part batch B",
      quantity: 1,
      unitCost: 80_000,
      unitSalePrice: 250_000,
    }).expect(201);
    await postPartUsed(approved.orderId, {
      quoteItemId: approved.partItemId,
      name: "Branch correction",
      quantity: 1,
      supersedesId: first.body.data.id,
    }).expect(409);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/repair-orders/${approved.orderId}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .set("X-Shop-Id", fixture.shopAId)
      .expect(200);
    expect(detail.body.data.partsUsed).toHaveLength(3);
    expect(
      detail.body.data.partsUsed.find((part: { id: string }) => part.id === first.body.data.id),
    ).toMatchObject({ isEffective: false, unitCost: 100_000 });
    expect(
      detail.body.data.partsUsed.find(
        (part: { id: string }) => part.id === correction.body.data.id,
      ),
    ).toMatchObject({ isEffective: true, unitCost: 90_000 });
    const publicEvents = detail.body.data.timeline.map(
      (event: { publicPayload: Record<string, unknown> | null }) => event.publicPayload,
    );
    expect(JSON.stringify(publicEvents)).not.toContain("90000");
    expect(JSON.stringify(publicEvents)).not.toContain("unitCost");
  });

  it("rolls back failed commands and permits a corrected retry with the same key", async () => {
    const approved = await createApprovedOrder();
    const key = `rollback-${randomUUID()}`;
    await postPartUsed(
      approved.orderId,
      { quoteItemId: approved.partItemId, name: "Overflow", quantity: 2.01 },
      { key },
    ).expect(409);
    expect(await prisma.partUsed.count({ where: { repairOrderId: approved.orderId } })).toBe(0);
    expect(
      await prisma.orderEvent.count({
        where: { repairOrderId: approved.orderId, eventType: "PART_USED_RECORDED" },
      }),
    ).toBe(0);
    const retry = await postPartUsed(
      approved.orderId,
      { quoteItemId: approved.partItemId, name: "Valid", quantity: 2 },
      { key },
    ).expect(201);
    expect(retry.body.data.quantity).toBe(2);
  });
});
