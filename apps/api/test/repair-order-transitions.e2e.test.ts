import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  ActorType,
  CompletionOutcome,
  DeviceType,
  MediaPurpose,
  MembershipRole,
  MembershipStatus,
  PartRequirementStatus,
  PaymentMethod,
  QcRunResult,
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
import { RepairOrderStateMachineService } from "../src/modules/repair-orders/state-machine/repair-order-state-machine.service.js";

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
  ownerToken: string;
  receptionistToken: string;
  technicianToken: string;
  userIds: string[];
}

describe("repair-order transition API", () => {
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
      prisma.shop.create({
        data: { name: `Transitions A ${suffix}`, slug: `transitions-a-${suffix}` },
      }),
      prisma.shop.create({
        data: { name: `Transitions B ${suffix}`, slug: `transitions-b-${suffix}` },
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
          name: "Transition Customer A",
          phoneRaw: "0900000041",
          phoneNormalized: "+84900000041",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "Transition Customer B",
          phoneRaw: "0900000042",
          phoneNormalized: "+84900000042",
        },
      }),
    ]);
    const [deviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopA.id,
          customerId: customerA.id,
          type: DeviceType.PHONE,
          brand: "Test",
          model: "A",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopB.id,
          customerId: customerB.id,
          type: DeviceType.LAPTOP,
          brand: "Test",
          model: "B",
        },
      }),
    ]);
    const specs = [
      ["Owner A", MembershipRole.OWNER, shopA.id],
      ["Receptionist A", MembershipRole.RECEPTIONIST, shopA.id],
      ["Technician A", MembershipRole.TECHNICIAN, shopA.id],
      ["Owner B", MembershipRole.OWNER, shopB.id],
    ] as const;
    const users = await Promise.all(
      specs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf032-${index}-${suffix}@example.com`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    await prisma.shopMembership.createMany({
      data: specs.map(([, role, shopId], index) => ({
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
      ownerId: users[0]!.id,
      technicianId: users[2]!.id,
      ownerToken: tokenService.createAccessToken(users[0]!.id).token,
      receptionistToken: tokenService.createAccessToken(users[1]!.id).token,
      technicianToken: tokenService.createAccessToken(users[2]!.id).token,
      userIds: users.map((user) => user.id),
    };
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcResultEvidence.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcResult.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcRun.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcTemplateItem.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.qcTemplate.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.payment.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.partUsed.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.partRequirement.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.workLog.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteApproval.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteItem.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.quoteVersion.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.diagnosis.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.orderEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.assignment.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.mediaAsset.deleteMany({ where: { shopId: { in: shopIds } } });
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
    assigned?: boolean;
    photo?: boolean;
  }): Promise<string> {
    const shopA = options?.shop !== "B";
    const shopId = shopA ? fixture.shopAId : fixture.shopBId;
    const branchId = shopA ? fixture.branchAId : fixture.branchBId;
    const customerId = shopA ? fixture.customerAId : fixture.customerBId;
    const deviceId = shopA ? fixture.deviceAId : fixture.deviceBId;
    const orderNo = nextOrderNo++;
    const order = await prisma.repairOrder.create({
      data: {
        shopId,
        branchId,
        customerId,
        deviceId,
        orderNo,
        code: `TRANSITION-${shopA ? "A" : "B"}-${orderNo}`,
        status: options?.status ?? RepairOrderStatus.RECEIVED,
        reportedProblem: "Test problem",
        intakeCondition: "Device has visible scratches",
        consentAcknowledgedAt: new Date(),
        customerSnapshot: { name: "Snapshot customer", phone: "0900000000" },
        deviceSnapshot: { type: DeviceType.PHONE, brand: "Test", model: "Snapshot" },
        createdByUserId: shopA ? fixture.ownerId : fixture.userIds[3]!,
      },
    });
    if (shopA && options?.assigned) {
      await prisma.assignment.create({
        data: {
          shopId,
          repairOrderId: order.id,
          technicianUserId: fixture.technicianId,
          assignedByUserId: fixture.ownerId,
        },
      });
    }
    if (shopA && options?.photo) {
      await prisma.mediaAsset.create({
        data: {
          shopId,
          repairOrderId: order.id,
          purpose: MediaPurpose.INTAKE,
          objectKey: `shops/${shopId}/intake/${randomUUID()}.jpg`,
          originalName: "intake.jpg",
          mimeType: "image/jpeg",
          byteSize: 128,
          uploadedByUserId: fixture.ownerId,
          uploadedAt: new Date(),
          expiresAt: null,
        },
      });
    }
    return order.id;
  }

  function transitionRequest(
    orderId: string,
    token = fixture.ownerToken,
    shopId = fixture.shopAId,
    key = `transition-${randomUUID()}`,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/repair-orders/${orderId}/transition`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Shop-Id", shopId)
      .set("Idempotency-Key", key);
  }

  const payload = (targetStatus: RepairOrderStatus, expectedLockVersion = 0) => ({
    targetStatus,
    expectedLockVersion,
  });

  async function createApprovedScope(
    repairOrderId: string,
    kinds: QuoteItemKind[],
  ): Promise<Array<{ id: string; scopeKey: string; kind: QuoteItemKind }>> {
    const items = kinds.map((kind, index) => ({
      id: randomUUID(),
      scopeKey: randomUUID(),
      kind,
      description: `${kind} item ${index + 1}`,
      quantity: 1,
      quantityUnit: QuoteQuantityUnit.EACH,
      unitPrice: kind === QuoteItemKind.FEE ? 0 : 100_000,
      lineTotal: kind === QuoteItemKind.FEE ? 0 : 100_000,
      isOptional: false,
      approvalGroup: null,
    }));
    const total = BigInt(items.reduce((sum, item) => sum + item.lineTotal, 0));
    const quote = await prisma.quoteVersion.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId,
        versionNo: 1,
        status: QuoteStatus.ACCEPTED,
        subtotal: total,
        total,
        sentAt: new Date(),
        decidedAt: new Date(),
        createdByUserId: fixture.ownerId,
        items: {
          create: items.map((item, sortOrder) => ({ ...item, sortOrder })),
        },
      },
    });
    await prisma.quoteApproval.create({
      data: {
        shopId: fixture.shopAId,
        quoteVersionId: quote.id,
        decision: QuoteDecision.ACCEPTED,
        approvedItemSnapshot: items.map((item) => ({
          ...item,
          carriedFromQuoteItemId: null,
          displayNote: null,
        })) as Prisma.InputJsonValue,
        approvedTotal: total,
        idempotencyKeyHash: randomUUID(),
      },
    });
    return items.map(({ id, scopeKey, kind }) => ({ id, scopeKey, kind }));
  }

  it("starts diagnosis atomically and allows the actively assigned technician", async () => {
    const ownerOrderId = await createOrder({ assigned: true, photo: true });
    const ownerResponse = await transitionRequest(ownerOrderId)
      .set("X-Request-Id", "req-rf032-owner")
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(200);
    expect(ownerResponse.body.data).toMatchObject({
      id: ownerOrderId,
      status: RepairOrderStatus.DIAGNOSING,
      lockVersion: 1,
      assignedTechnicianUserId: fixture.technicianId,
    });
    expect(
      await prisma.orderEvent.findFirstOrThrow({
        where: { repairOrderId: ownerOrderId, eventType: "ORDER_STATUS_CHANGED" },
      }),
    ).toMatchObject({
      fromStatus: RepairOrderStatus.RECEIVED,
      toStatus: RepairOrderStatus.DIAGNOSING,
      actorUserId: fixture.ownerId,
      requestId: "req-rf032-owner",
    });

    const technicianOrderId = await createOrder({ assigned: true, photo: true });
    await transitionRequest(technicianOrderId, fixture.technicianToken)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(200);
  });

  it("enforces role rules for start diagnosis, void, and return to diagnosis", async () => {
    const receptionistOrder = await createOrder({ assigned: true, photo: true });
    const deniedStart = await transitionRequest(receptionistOrder, fixture.receptionistToken)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(403);
    expect(deniedStart.body.error.code).toBe("PERMISSION_DENIED");

    const voidOrder = await createOrder();
    await transitionRequest(voidOrder).send(payload(RepairOrderStatus.VOIDED)).expect(200);
    const receptionistVoid = await createOrder();
    await transitionRequest(receptionistVoid, fixture.receptionistToken)
      .send(payload(RepairOrderStatus.VOIDED))
      .expect(403);

    const awaitingOrder = await createOrder({ status: RepairOrderStatus.AWAITING_APPROVAL });
    await transitionRequest(awaitingOrder, fixture.receptionistToken)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(200);
  });

  it("rejects missing intake evidence and void history without partial writes", async () => {
    const noAssignment = await createOrder({ photo: true });
    const assignmentFailure = await transitionRequest(noAssignment)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(409);
    expect(assignmentFailure.body.error.code).toBe("TECHNICIAN_NOT_ASSIGNED");

    const noPhoto = await createOrder({ assigned: true });
    const photoFailure = await transitionRequest(noPhoto)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(409);
    expect(photoFailure.body.error.code).toBe("INTAKE_PHOTOS_REQUIRED");

    const withQuote = await createOrder();
    await prisma.quoteVersion.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: withQuote,
        versionNo: 1,
        createdByUserId: fixture.ownerId,
      },
    });
    const historyFailure = await transitionRequest(withQuote)
      .send(payload(RepairOrderStatus.VOIDED))
      .expect(409);
    expect(historyFailure.body.error.code).toBe("REPAIR_ORDER_GUARD_FAILED");

    for (const orderId of [noAssignment, noPhoto, withQuote]) {
      expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
        status: RepairOrderStatus.RECEIVED,
        lockVersion: 0,
      });
      expect(
        await prisma.orderEvent.count({
          where: { repairOrderId: orderId, eventType: "ORDER_STATUS_CHANGED" },
        }),
      ).toBe(0);
    }
  });

  it("rejects unsupported, stale, cross-tenant, and unassigned-technician requests", async () => {
    const unsupported = await createOrder({ assigned: true, photo: true });
    const unsupportedResponse = await transitionRequest(unsupported)
      .send(payload(RepairOrderStatus.APPROVED))
      .expect(409);
    expect(unsupportedResponse.body.error.code).toBe("REPAIR_ORDER_INVALID_TRANSITION");

    const stale = await createOrder({ assigned: true, photo: true });
    const staleResponse = await transitionRequest(stale)
      .send(payload(RepairOrderStatus.DIAGNOSING, 9))
      .expect(409);
    expect(staleResponse.body.error.code).toBe("CONCURRENT_UPDATE");

    const crossTenant = await createOrder({ shop: "B" });
    const crossResponse = await transitionRequest(crossTenant)
      .send(payload(RepairOrderStatus.VOIDED))
      .expect(404);
    expect(crossResponse.body.error.code).toBe("RESOURCE_NOT_FOUND");

    const unassigned = await createOrder({ photo: true });
    const unassignedResponse = await transitionRequest(unassigned, fixture.technicianToken)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(404);
    expect(unassignedResponse.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("replays the same idempotency key and rejects a changed payload", async () => {
    const orderId = await createOrder({ assigned: true, photo: true });
    const key = `rf032-retry-${randomUUID()}`;
    const first = await transitionRequest(orderId, fixture.ownerToken, fixture.shopAId, key)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(200);
    const replay = await transitionRequest(orderId, fixture.ownerToken, fixture.shopAId, key)
      .send(payload(RepairOrderStatus.DIAGNOSING))
      .expect(200);
    const mismatch = await transitionRequest(orderId, fixture.ownerToken, fixture.shopAId, key)
      .send({ ...payload(RepairOrderStatus.DIAGNOSING), reason: "changed" })
      .expect(409);

    expect(replay.body).toEqual(first.body);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      await prisma.orderEvent.count({
        where: { repairOrderId: orderId, eventType: "ORDER_STATUS_CHANGED" },
      }),
    ).toBe(1);
  });

  it("allows only one concurrent request to win from a lock version", async () => {
    const orderId = await createOrder({ assigned: true, photo: true });
    const [first, second] = await Promise.all([
      transitionRequest(orderId).send(payload(RepairOrderStatus.DIAGNOSING)),
      transitionRequest(orderId).send(payload(RepairOrderStatus.DIAGNOSING)),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(
      await prisma.orderEvent.count({
        where: { repairOrderId: orderId, eventType: "ORDER_STATUS_CHANGED" },
      }),
    ).toBe(1);
    expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      status: RepairOrderStatus.DIAGNOSING,
      lockVersion: 1,
    });
  });

  it("guards diagnosed non-repair and early cancellation outcomes", async () => {
    const missingDiagnosis = await createOrder({ status: RepairOrderStatus.DIAGNOSING });
    expect(
      (
        await transitionRequest(missingDiagnosis, fixture.receptionistToken)
          .send({
            ...payload(RepairOrderStatus.READY_FOR_PICKUP),
            completionOutcome: CompletionOutcome.UNREPAIRABLE,
          })
          .expect(409)
      ).body.error.code,
    ).toBe("REPAIR_ORDER_GUARD_FAILED");

    await prisma.diagnosis.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: missingDiagnosis,
        revisionNo: 1,
        finding: "Main board is irreparable",
        recommendation: "Return device",
        createdByUserId: fixture.ownerId,
      },
    });
    const ready = await transitionRequest(missingDiagnosis, fixture.receptionistToken)
      .send({
        ...payload(RepairOrderStatus.READY_FOR_PICKUP),
        completionOutcome: CompletionOutcome.UNREPAIRABLE,
      })
      .expect(200);
    expect(ready.body.data).toMatchObject({
      status: RepairOrderStatus.READY_FOR_PICKUP,
      completionOutcome: CompletionOutcome.UNREPAIRABLE,
      lockVersion: 1,
    });
    expect(ready.body.data.readyAt).toEqual(expect.any(String));

    const technicianOrder = await createOrder({
      status: RepairOrderStatus.DIAGNOSING,
      assigned: true,
    });
    await prisma.diagnosis.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: technicianOrder,
        revisionNo: 1,
        finding: "No fault reproduced",
        recommendation: "Return device",
        createdByUserId: fixture.technicianId,
      },
    });
    expect(
      (
        await transitionRequest(technicianOrder, fixture.technicianToken)
          .send({
            ...payload(RepairOrderStatus.READY_FOR_PICKUP),
            completionOutcome: CompletionOutcome.NO_FAULT_FOUND,
          })
          .expect(403)
      ).body.error.code,
    ).toBe("PERMISSION_DENIED");

    const noteOnly = await createOrder({ status: RepairOrderStatus.DIAGNOSING });
    await prisma.workLog.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: noteOnly,
        type: WorkLogType.CUSTOMER_CONTACT,
        content: "Customer requested cancellation",
        createdByUserId: fixture.ownerId,
      },
    });
    await transitionRequest(noteOnly, fixture.receptionistToken)
      .send({
        ...payload(RepairOrderStatus.READY_FOR_PICKUP),
        completionOutcome: CompletionOutcome.CUSTOMER_CANCELLED,
        reason: "Customer changed their mind",
      })
      .expect(200);

    const missingReason = await createOrder({ status: RepairOrderStatus.DIAGNOSING });
    await transitionRequest(missingReason, fixture.receptionistToken)
      .send({
        ...payload(RepairOrderStatus.READY_FOR_PICKUP),
        completionOutcome: CompletionOutcome.CUSTOMER_CANCELLED,
        reason: "   ",
      })
      .expect(409);

    const sentHistory = await createOrder({ status: RepairOrderStatus.DIAGNOSING });
    await prisma.quoteVersion.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: sentHistory,
        versionNo: 1,
        status: QuoteStatus.SUPERSEDED,
        sentAt: new Date(),
        createdByUserId: fixture.ownerId,
      },
    });
    await transitionRequest(sentHistory, fixture.receptionistToken)
      .send({
        ...payload(RepairOrderStatus.READY_FOR_PICKUP),
        completionOutcome: CompletionOutcome.CUSTOMER_CANCELLED,
        reason: "Too late",
      })
      .expect(409);
    expect(
      await prisma.repairOrder.findUniqueOrThrow({ where: { id: sentHistory } }),
    ).toMatchObject({ status: RepairOrderStatus.DIAGNOSING, lockVersion: 0 });

    const paymentHistory = await createOrder({ status: RepairOrderStatus.DIAGNOSING });
    await prisma.payment.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: paymentHistory,
        amount: 1n,
        method: PaymentMethod.CASH,
        receivedByUserId: fixture.ownerId,
      },
    });
    const workHistory = await createOrder({ status: RepairOrderStatus.DIAGNOSING });
    await prisma.workLog.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: workHistory,
        type: WorkLogType.REPAIR,
        content: "Technical work already started",
        createdByUserId: fixture.ownerId,
      },
    });
    const partHistory = await createOrder({ status: RepairOrderStatus.DIAGNOSING });
    await prisma.partUsed.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: partHistory,
        name: "Legacy part evidence",
        quantity: 1,
        createdByUserId: fixture.ownerId,
      },
    });
    for (const blockedOrderId of [paymentHistory, workHistory, partHistory]) {
      await transitionRequest(blockedOrderId, fixture.receptionistToken)
        .send({
          ...payload(RepairOrderStatus.READY_FOR_PICKUP),
          completionOutcome: CompletionOutcome.CUSTOMER_CANCELLED,
          reason: "Customer requested cancellation",
        })
        .expect(409);
      expect(
        await prisma.repairOrder.findUniqueOrThrow({ where: { id: blockedOrderId } }),
      ).toMatchObject({ status: RepairOrderStatus.DIAGNOSING, lockVersion: 0 });
    }
  });

  it("uses the current approved part scope for waiting and repair start", async () => {
    const orderId = await createOrder({ status: RepairOrderStatus.APPROVED, assigned: true });
    const [part] = await createApprovedScope(orderId, [QuoteItemKind.PART]);

    await transitionRequest(orderId, fixture.technicianToken)
      .send(payload(RepairOrderStatus.WAITING_PARTS))
      .expect(409);
    await prisma.partRequirement.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: orderId,
        quoteItemId: part!.id,
        scopeKey: part!.scopeKey,
        nameSnapshot: "Replacement part",
        quantity: 1,
        quantityUnit: QuoteQuantityUnit.EACH,
        status: PartRequirementStatus.NEEDED,
        createdByUserId: fixture.ownerId,
        updatedByUserId: fixture.ownerId,
      },
    });
    await transitionRequest(orderId, fixture.receptionistToken)
      .send(payload(RepairOrderStatus.WAITING_PARTS))
      .expect(403);
    await transitionRequest(orderId, fixture.technicianToken)
      .send(payload(RepairOrderStatus.WAITING_PARTS))
      .expect(200);
    await transitionRequest(orderId, fixture.technicianToken)
      .send(payload(RepairOrderStatus.REPAIRING, 1))
      .expect(409);

    await prisma.partRequirement.updateMany({
      where: { repairOrderId: orderId, scopeKey: part!.scopeKey },
      data: { status: PartRequirementStatus.AVAILABLE },
    });
    await transitionRequest(orderId, fixture.technicianToken)
      .send(payload(RepairOrderStatus.REPAIRING, 1))
      .expect(200);
    expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      status: RepairOrderStatus.REPAIRING,
      lockVersion: 2,
    });
  });

  it("requires effective item-level work coverage before quality check", async () => {
    const orderId = await createOrder({ status: RepairOrderStatus.REPAIRING, assigned: true });
    const [service, part] = await createApprovedScope(orderId, [
      QuoteItemKind.SERVICE,
      QuoteItemKind.PART,
    ]);
    const serviceRoot = await prisma.workLog.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: orderId,
        quoteItemId: service!.id,
        type: WorkLogType.REPAIR,
        content: "Repaired service scope",
        createdByUserId: fixture.technicianId,
      },
    });
    await prisma.workLog.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: orderId,
        quoteItemId: null,
        supersedesId: serviceRoot.id,
        type: WorkLogType.CORRECTION,
        content: "Corrected service evidence",
        createdByUserId: fixture.technicianId,
      },
    });
    await transitionRequest(orderId, fixture.technicianToken)
      .send(payload(RepairOrderStatus.QUALITY_CHECK))
      .expect(409);
    await prisma.workLog.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: orderId,
        quoteItemId: part!.id,
        type: WorkLogType.TEST,
        content: "Tested replacement part",
        createdByUserId: fixture.technicianId,
      },
    });
    await transitionRequest(orderId, fixture.technicianToken)
      .send(payload(RepairOrderStatus.QUALITY_CHECK))
      .expect(200);

    const feeOnly = await createOrder({ status: RepairOrderStatus.REPAIRING, assigned: true });
    await createApprovedScope(feeOnly, [QuoteItemKind.FEE]);
    await transitionRequest(feeOnly).send(payload(RepairOrderStatus.QUALITY_CHECK)).expect(200);
  });

  it("uses only the latest QC result and blocks internal-only edges on the public command", async () => {
    const orderId = await createOrder({ status: RepairOrderStatus.QUALITY_CHECK, assigned: true });
    const template = await prisma.qcTemplate.create({
      data: {
        shopId: fixture.shopAId,
        name: `Transition QC ${randomUUID()}`,
        normalizedName: `transition-qc-${randomUUID()}`,
        versionNo: 1,
      },
    });
    await prisma.qcRun.createMany({
      data: [
        {
          shopId: fixture.shopAId,
          repairOrderId: orderId,
          qcTemplateId: template.id,
          runNo: 1,
          result: QcRunResult.PASS,
          checkedByUserId: fixture.ownerId,
        },
        {
          shopId: fixture.shopAId,
          repairOrderId: orderId,
          qcTemplateId: template.id,
          runNo: 2,
          result: QcRunResult.FAIL,
          notes: "Still intermittent",
          checkedByUserId: fixture.ownerId,
        },
      ],
    });
    await transitionRequest(orderId, fixture.technicianToken)
      .send({
        ...payload(RepairOrderStatus.READY_FOR_PICKUP),
        completionOutcome: CompletionOutcome.REPAIRED,
      })
      .expect(409);
    await prisma.qcRun.create({
      data: {
        shopId: fixture.shopAId,
        repairOrderId: orderId,
        qcTemplateId: template.id,
        runNo: 3,
        result: QcRunResult.PASS,
        checkedByUserId: fixture.ownerId,
      },
    });
    await transitionRequest(orderId, fixture.technicianToken)
      .send({
        ...payload(RepairOrderStatus.READY_FOR_PICKUP),
        completionOutcome: CompletionOutcome.REPAIRED,
      })
      .expect(200);
    await transitionRequest(orderId).send(payload(RepairOrderStatus.COMPLETED, 1)).expect(409);

    const failedQc = await createOrder({
      status: RepairOrderStatus.QUALITY_CHECK,
      assigned: true,
    });
    await transitionRequest(failedQc, fixture.technicianToken)
      .send(payload(RepairOrderStatus.REPAIRING))
      .expect(409);
  });

  it("commits failed-QC evidence with its internal transition and rolls both back on event failure", async () => {
    const stateMachine = app.get(RepairOrderStateMachineService);
    const template = await prisma.qcTemplate.create({
      data: {
        shopId: fixture.shopAId,
        name: `Internal QC ${randomUUID()}`,
        normalizedName: `internal-qc-${randomUUID()}`,
        versionNo: 1,
      },
    });
    const successOrder = await createOrder({
      status: RepairOrderStatus.QUALITY_CHECK,
      assigned: true,
    });
    await prisma.$transaction(async (transaction) => {
      const run = await transaction.qcRun.create({
        data: {
          shopId: fixture.shopAId,
          repairOrderId: successOrder,
          qcTemplateId: template.id,
          runNo: 1,
          result: QcRunResult.FAIL,
          notes: "Connector still fails under load",
          checkedByUserId: fixture.technicianId,
        },
      });
      await stateMachine.transitionAfterQcFailure(transaction, {
        shopId: fixture.shopAId,
        repairOrderId: successOrder,
        targetStatus: RepairOrderStatus.REPAIRING,
        completionOutcome: null,
        reason: "QC failed",
        expectedLockVersion: 0,
        evidenceId: run.id,
        actor: {
          type: ActorType.USER,
          userId: fixture.technicianId,
          role: MembershipRole.TECHNICIAN,
        },
        requestId: "rf041-qc-internal",
      });
    });
    expect(
      await prisma.repairOrder.findUniqueOrThrow({ where: { id: successOrder } }),
    ).toMatchObject({ status: RepairOrderStatus.REPAIRING, lockVersion: 1 });

    const rollbackOrder = await createOrder({
      status: RepairOrderStatus.QUALITY_CHECK,
      assigned: true,
    });
    const functionName = `rf041_internal_event_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const triggerName = `${functionName}_trigger`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."repairOrderId" = '${rollbackOrder}'::uuid THEN
          RAISE EXCEPTION 'forced RF-041 internal event failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "order_events"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);
    try {
      await expect(
        prisma.$transaction(async (transaction) => {
          const run = await transaction.qcRun.create({
            data: {
              shopId: fixture.shopAId,
              repairOrderId: rollbackOrder,
              qcTemplateId: template.id,
              runNo: 1,
              result: QcRunResult.FAIL,
              notes: "Must roll back",
              checkedByUserId: fixture.ownerId,
            },
          });
          await stateMachine.transitionAfterQcFailure(transaction, {
            shopId: fixture.shopAId,
            repairOrderId: rollbackOrder,
            targetStatus: RepairOrderStatus.REPAIRING,
            completionOutcome: null,
            reason: "QC failed",
            expectedLockVersion: 0,
            evidenceId: run.id,
            actor: {
              type: ActorType.USER,
              userId: fixture.ownerId,
              role: MembershipRole.OWNER,
            },
            requestId: "rf041-qc-rollback",
          });
        }),
      ).rejects.toThrow();
      expect(await prisma.qcRun.count({ where: { repairOrderId: rollbackOrder } })).toBe(0);
      expect(
        await prisma.repairOrder.findUniqueOrThrow({ where: { id: rollbackOrder } }),
      ).toMatchObject({ status: RepairOrderStatus.QUALITY_CHECK, lockVersion: 0 });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "order_events";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  });

  it("rolls back status, event, and idempotency when event persistence fails", async () => {
    const orderId = await createOrder({ assigned: true, photo: true });
    const key = `rf032-rollback-${randomUUID()}`;
    const idempotencyCountBefore = await prisma.idempotencyRecord.count({
      where: { shopId: fixture.shopAId, scope: "repair-orders.transition" },
    });
    const functionName = `rf032_fail_event_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const triggerName = `${functionName}_trigger`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."repairOrderId" = '${orderId}'::uuid THEN
          RAISE EXCEPTION 'forced RF-032 event failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "order_events"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);

    try {
      await transitionRequest(orderId, fixture.ownerToken, fixture.shopAId, key)
        .send(payload(RepairOrderStatus.DIAGNOSING))
        .expect(500);
      expect(await prisma.repairOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
        status: RepairOrderStatus.RECEIVED,
        lockVersion: 0,
      });
      expect(await prisma.orderEvent.count({ where: { repairOrderId: orderId } })).toBe(0);
      expect(
        await prisma.idempotencyRecord.count({
          where: { shopId: fixture.shopAId, scope: "repair-orders.transition" },
        }),
      ).toBe(idempotencyCountBefore);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "order_events";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  });
});
