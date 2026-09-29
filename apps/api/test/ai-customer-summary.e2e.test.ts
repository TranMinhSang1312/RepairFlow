import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  AiCapability,
  DeviceType,
  MembershipRole,
  MembershipStatus,
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
import { AI_GLOBAL_ENABLED } from "../src/modules/ai/ai.tokens.js";

interface Actor {
  userId: string;
  token: string;
}

describe("RF-061 customer-safe summary enqueue", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let shopAId: string;
  let shopBId: string;
  let orderAId: string;
  let orderA2Id: string;
  let orderBId: string;
  let diagnosisId: string;
  let supersededDiagnosisId: string;
  let validWorkLogId: string;
  let internalWorkLogId: string;
  let internalCorrectionId: string;
  let otherOrderWorkLogId: string;
  let ownerA: Actor;
  let receptionistA: Actor;
  let assignedTechnicianA: Actor;
  let unassignedTechnicianA: Actor;
  let ownerB: Actor;
  let userIds: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_GLOBAL_ENABLED)
      .useValue(true)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);

    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `RF061 A ${suffix}`, slug: `rf061-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `RF061 B ${suffix}`, slug: `rf061-b-${suffix}` } }),
    ]);
    shopAId = shopA.id;
    shopBId = shopB.id;
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopAId, name: "Main A" } }),
      prisma.branch.create({ data: { shopId: shopBId, name: "Main B" } }),
    ]);
    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shopAId,
          name: "Customer A",
          phoneRaw: "0901234567",
          phoneNormalized: "+84901234567",
          email: "private-a@example.test",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopBId,
          name: "Customer B",
          phoneRaw: "0907654321",
          phoneNormalized: "+84907654321",
        },
      }),
    ]);
    const [deviceA, deviceB] = await Promise.all([
      prisma.device.create({
        data: {
          shopId: shopAId,
          customerId: customerA.id,
          type: DeviceType.PHONE,
          brand: "Test",
          model: "A",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopBId,
          customerId: customerB.id,
          type: DeviceType.LAPTOP,
          brand: "Test",
          model: "B",
        },
      }),
    ]);
    const specs = [
      ["Owner A", MembershipRole.OWNER, shopAId],
      ["Receptionist A", MembershipRole.RECEPTIONIST, shopAId],
      ["Assigned Tech A", MembershipRole.TECHNICIAN, shopAId],
      ["Unassigned Tech A", MembershipRole.TECHNICIAN, shopAId],
      ["Owner B", MembershipRole.OWNER, shopBId],
    ] as const;
    const users = await Promise.all(
      specs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf061-${index}-${suffix}@example.test`,
            passwordHash: "test-only",
            displayName,
          },
        }),
      ),
    );
    userIds = users.map((user) => user.id);
    await prisma.shopMembership.createMany({
      data: specs.map(([, role, shopId], index) => ({
        shopId,
        userId: users[index]!.id,
        role,
        status: MembershipStatus.ACTIVE,
      })),
    });
    const actor = (index: number): Actor => ({
      userId: users[index]!.id,
      token: tokenService.createAccessToken(users[index]!.id).token,
    });
    ownerA = actor(0);
    receptionistA = actor(1);
    assignedTechnicianA = actor(2);
    unassignedTechnicianA = actor(3);
    ownerB = actor(4);

    const createOrder = (
      shopId: string,
      branchId: string,
      customerId: string,
      deviceId: string,
      createdByUserId: string,
      orderNo: number,
    ) =>
      prisma.repairOrder.create({
        data: {
          shopId,
          branchId,
          customerId,
          deviceId,
          orderNo,
          code: `RF061-${shopId.slice(0, 4)}-${orderNo}-${suffix}`,
          status: RepairOrderStatus.DIAGNOSING,
          reportedProblem: "Summary test",
          intakeCondition: "Used",
          consentAcknowledgedAt: new Date(),
          customerSnapshot: { name: "Snapshot" },
          deviceSnapshot: { type: DeviceType.PHONE, brand: "Test", model: "A" },
          createdByUserId,
        },
      });
    const [orderA, orderA2, orderB] = await Promise.all([
      createOrder(shopAId, branchA.id, customerA.id, deviceA.id, ownerA.userId, 61),
      createOrder(shopAId, branchA.id, customerA.id, deviceA.id, ownerA.userId, 62),
      createOrder(shopBId, branchB.id, customerB.id, deviceB.id, ownerB.userId, 61),
    ]);
    orderAId = orderA.id;
    orderA2Id = orderA2.id;
    orderBId = orderB.id;
    await prisma.assignment.create({
      data: {
        shopId: shopAId,
        repairOrderId: orderAId,
        technicianUserId: assignedTechnicianA.userId,
        assignedByUserId: ownerA.userId,
      },
    });
    const [oldDiagnosis, currentDiagnosis] = await Promise.all([
      prisma.diagnosis.create({
        data: {
          shopId: shopAId,
          repairOrderId: orderAId,
          revisionNo: 1,
          finding: "Chẩn đoán cũ",
          recommendation: "Không dùng",
          createdByUserId: assignedTechnicianA.userId,
        },
      }),
      prisma.diagnosis.create({
        data: {
          shopId: shopAId,
          repairOrderId: orderAId,
          revisionNo: 2,
          finding: "Pin bị phồng. Liên hệ 0901234567 hoặc private-a@example.test",
          recommendation: "Kiểm tra nguồn; password: secret123; giá 500.000 VND",
          createdByUserId: assignedTechnicianA.userId,
        },
      }),
    ]);
    await prisma.diagnosis.update({
      where: { id: currentDiagnosis.id },
      data: { supersedesId: oldDiagnosis.id },
    });
    diagnosisId = currentDiagnosis.id;
    supersededDiagnosisId = oldDiagnosis.id;
    const [validLog, internalLog, otherLog] = await Promise.all([
      prisma.workLog.create({
        data: {
          shopId: shopAId,
          repairOrderId: orderAId,
          type: WorkLogType.TEST,
          content: "Đã kiểm tra nguồn và vệ sinh cổng sạc.",
          createdByUserId: assignedTechnicianA.userId,
        },
      }),
      prisma.workLog.create({
        data: {
          shopId: shopAId,
          repairOrderId: orderAId,
          type: WorkLogType.INTERNAL_NOTE,
          content: "Internal cost 999999 and supplier secret",
          createdByUserId: assignedTechnicianA.userId,
        },
      }),
      prisma.workLog.create({
        data: {
          shopId: shopAId,
          repairOrderId: orderA2Id,
          type: WorkLogType.TEST,
          content: "Other order log",
          createdByUserId: ownerA.userId,
        },
      }),
    ]);
    validWorkLogId = validLog.id;
    internalWorkLogId = internalLog.id;
    otherOrderWorkLogId = otherLog.id;
    const internalCorrection = await prisma.workLog.create({
      data: {
        shopId: shopAId,
        repairOrderId: orderAId,
        type: WorkLogType.CORRECTION,
        supersedesId: internalLog.id,
        content: "Corrected internal supplier note",
        createdByUserId: assignedTechnicianA.userId,
      },
    });
    internalCorrectionId = internalCorrection.id;
    await prisma.aiCapabilitySetting.create({
      data: {
        shopId: shopAId,
        capability: AiCapability.CUSTOMER_SUMMARY,
        enabled: true,
        monthlyBudgetMicrousd: 100_000n,
        maxRunCostMicrousd: 10_000n,
        updatedByUserId: ownerA.userId,
      },
    });
  });

  afterAll(async () => {
    const shopIds = [shopAId, shopBId];
    await prisma.outboxEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.aiRun.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.aiUsagePeriod.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.aiCapabilitySetting.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.workLog.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.diagnosis.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.assignment.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  function enqueue(
    actor: Actor,
    body: Record<string, unknown>,
    key = `rf061-${randomUUID()}`,
    shopId = shopAId,
  ) {
    return request(app.getHttpServer())
      .post("/api/v1/ai/customer-summaries")
      .set("Authorization", `Bearer ${actor.token}`)
      .set("X-Shop-Id", shopId)
      .set("Idempotency-Key", key)
      .send(body);
  }

  function validBody() {
    return {
      repairOrderId: orderAId,
      diagnosisId,
      workLogIds: [validWorkLogId],
      tone: "CLEAR_NEUTRAL",
      maxCharacters: 400,
    };
  }

  it.each(["owner", "receptionist", "assigned technician"])(
    "enqueues a redacted, minimal snapshot for %s",
    async (role) => {
      const actor =
        role === "owner" ? ownerA : role === "receptionist" ? receptionistA : assignedTechnicianA;
      const response = await enqueue(actor, validBody()).expect(202);
      expect(response.body.data).toMatchObject({
        capability: AiCapability.CUSTOMER_SUMMARY,
        status: "QUEUED",
        promptVersion: "customer-summary-v1",
        schemaVersion: "1",
      });
      const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: response.body.data.id } });
      const snapshot = JSON.stringify(run.inputReference);
      expect(snapshot).toContain('"id":"diagnosis-finding"');
      expect(snapshot).toContain('"id":"work-log-1"');
      expect(snapshot).not.toContain(diagnosisId);
      expect(snapshot).not.toContain(validWorkLogId);
      for (const forbidden of [
        "0901234567",
        "private-a@example.test",
        "secret123",
        "500.000",
        "Internal cost",
      ]) {
        expect(snapshot).not.toContain(forbidden);
      }
      const outbox = await prisma.outboxEvent.findFirstOrThrow({
        where: { aggregateId: run.id },
      });
      expect(outbox.payload).toEqual({
        schemaVersion: 1,
        aiRunId: run.id,
        shopId: shopAId,
        capability: AiCapability.CUSTOMER_SUMMARY,
      });
    },
  );

  it("rejects empty, mixed-order, internal and superseded sources without creating a run", async () => {
    const before = await prisma.aiRun.count({ where: { shopId: shopAId } });
    await enqueue(ownerA, { ...validBody(), diagnosisId: undefined, workLogIds: [] }).expect(422);
    await enqueue(ownerA, { ...validBody(), workLogIds: [otherOrderWorkLogId] }).expect(404);
    await enqueue(ownerA, {
      ...validBody(),
      diagnosisId: undefined,
      workLogIds: [internalWorkLogId],
    }).expect(404);
    await enqueue(ownerA, {
      ...validBody(),
      diagnosisId: undefined,
      workLogIds: [internalCorrectionId],
    }).expect(404);
    await enqueue(ownerA, {
      ...validBody(),
      diagnosisId: supersededDiagnosisId,
      workLogIds: [],
    }).expect(404);
    expect(await prisma.aiRun.count({ where: { shopId: shopAId } })).toBe(before);
  });

  it("hides cross-tenant sources and unassigned orders from technicians", async () => {
    await enqueue(unassignedTechnicianA, validBody()).expect(404);
    const crossTenant = await enqueue(ownerA, {
      ...validBody(),
      repairOrderId: orderBId,
      workLogIds: [],
    }).expect(404);
    expect(crossTenant.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("replays the same key and rejects payload mismatch", async () => {
    const key = `rf061-stable-${randomUUID()}`;
    const first = await enqueue(ownerA, validBody(), key).expect(202);
    const replay = await enqueue(ownerA, validBody(), key).expect(202);
    expect(replay.body.data.id).toBe(first.body.data.id);
    const mismatch = await enqueue(ownerA, { ...validBody(), maxCharacters: 401 }, key).expect(409);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await prisma.aiRun.count({ where: { id: first.body.data.id as string } })).toBe(1);
  });

  it("fails closed when the shop capability is disabled", async () => {
    await prisma.aiCapabilitySetting.update({
      where: { shopId_capability: { shopId: shopAId, capability: AiCapability.CUSTOMER_SUMMARY } },
      data: { enabled: false },
    });
    const response = await enqueue(ownerA, validBody()).expect(409);
    expect(response.body.error.code).toBe("AI_FEATURE_DISABLED");
    await prisma.aiCapabilitySetting.update({
      where: { shopId_capability: { shopId: shopAId, capability: AiCapability.CUSTOMER_SUMMARY } },
      data: { enabled: true },
    });
  });
});
