import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AiCapability, DeviceType, MembershipRole, MembershipStatus } from "@prisma/client";
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

describe("RF-064 checklist suggestion enqueue", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let shopAId: string;
  let shopBId: string;
  let assignedOrderId: string;
  let unassignedOrderId: string;
  let activeTemplateId: string;
  let inactiveTemplateId: string;
  let emptyTemplateId: string;
  let otherTemplateId: string;
  let itemIds: string[];
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
    const tokens = app.get(TokenService);
    const suffix = randomUUID().slice(0, 8);

    const [shopA, shopB] = await Promise.all([
      prisma.shop.create({ data: { name: `RF064 A ${suffix}`, slug: `rf064-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `RF064 B ${suffix}`, slug: `rf064-b-${suffix}` } }),
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
          name: "Private Customer A",
          phoneRaw: "0901234567",
          phoneNormalized: "+84901234567",
          email: "private-a@example.test",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopBId,
          name: "Private Customer B",
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
      ["Assigned tech A", MembershipRole.TECHNICIAN, shopAId],
      ["Unassigned tech A", MembershipRole.TECHNICIAN, shopAId],
      ["Owner B", MembershipRole.OWNER, shopBId],
    ] as const;
    const users = await Promise.all(
      specs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf064-${index}-${suffix}@example.test`,
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
      token: tokens.createAccessToken(users[index]!.id).token,
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
          code: `RF064-${shopId.slice(0, 4)}-${orderNo}-${suffix}`,
          reportedProblem:
            "Máy nóng và tự tắt. Liên hệ 0901234567; email private-a@example.test; password: secret-value.",
          intakeCondition: "Used",
          consentAcknowledgedAt: new Date(),
          customerSnapshot: { name: "Private snapshot" },
          deviceSnapshot: { type: DeviceType.PHONE, brand: "Test", model: "A" },
          createdByUserId,
        },
      });
    const [assignedOrder, unassignedOrder] = await Promise.all([
      createOrder(shopAId, branchA.id, customerA.id, deviceA.id, ownerA.userId, 64),
      createOrder(shopAId, branchA.id, customerA.id, deviceA.id, ownerA.userId, 65),
      createOrder(shopBId, branchB.id, customerB.id, deviceB.id, ownerB.userId, 64),
    ]);
    assignedOrderId = assignedOrder.id;
    unassignedOrderId = unassignedOrder.id;
    await prisma.assignment.create({
      data: {
        shopId: shopAId,
        repairOrderId: assignedOrderId,
        technicianUserId: assignedTechnicianA.userId,
        assignedByUserId: ownerA.userId,
      },
    });

    const active = await prisma.qcTemplate.create({
      data: {
        shopId: shopAId,
        name: "RF064 active",
        normalizedName: `rf064-active-${suffix}`,
        versionNo: 1,
        items: {
          create: [
            { label: "Kiểm tra nhiệt độ", sortOrder: 1 },
            {
              label: "Kiểm tra nguồn và email qc-private@example.test",
              sortOrder: 2,
              allowNa: true,
            },
          ],
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    const [inactive, empty, other] = await Promise.all([
      prisma.qcTemplate.create({
        data: {
          shopId: shopAId,
          name: "RF064 inactive",
          normalizedName: `rf064-inactive-${suffix}`,
          versionNo: 1,
          isActive: false,
          items: { create: { label: "Inactive item", sortOrder: 1 } },
        },
      }),
      prisma.qcTemplate.create({
        data: {
          shopId: shopAId,
          name: "RF064 empty",
          normalizedName: `rf064-empty-${suffix}`,
          versionNo: 1,
        },
      }),
      prisma.qcTemplate.create({
        data: {
          shopId: shopBId,
          name: "RF064 other",
          normalizedName: `rf064-other-${suffix}`,
          versionNo: 1,
          items: { create: { label: "Other tenant item", sortOrder: 1 } },
        },
      }),
    ]);
    activeTemplateId = active.id;
    inactiveTemplateId = inactive.id;
    emptyTemplateId = empty.id;
    otherTemplateId = other.id;
    itemIds = active.items.map((item) => item.id);
    await Promise.all(
      (
        [
          [shopAId, ownerA.userId],
          [shopBId, ownerB.userId],
        ] as const
      ).map(([shopId, updatedByUserId]) =>
        prisma.aiCapabilitySetting.create({
          data: {
            shopId,
            capability: AiCapability.CHECKLIST_SUGGESTION,
            enabled: true,
            monthlyBudgetMicrousd: 100_000n,
            maxRunCostMicrousd: 10_000n,
            updatedByUserId,
          },
        }),
      ),
    );
  });

  afterAll(async () => {
    const shops = [shopAId, shopBId];
    await prisma.outboxEvent.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.aiRun.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.aiUsagePeriod.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.aiCapabilitySetting.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.qcTemplateItem.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.qcTemplate.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.assignment.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.repairOrder.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.device.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.shopMembership.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.branch.deleteMany({ where: { shopId: { in: shops } } });
    await prisma.shop.deleteMany({ where: { id: { in: shops } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  function enqueue(
    actor: Actor,
    input: { repairOrderId: string; qcTemplateId: string; phase: "DIAGNOSIS" | "QC" },
    key = randomUUID(),
    shopId = shopAId,
  ) {
    return request(app.getHttpServer())
      .post("/api/v1/ai/checklist-suggestions")
      .set("Authorization", `Bearer ${actor.token}`)
      .set("X-Shop-Id", shopId)
      .set("Idempotency-Key", key)
      .send(input);
  }

  it.each([
    ["owner", () => ownerA],
    ["receptionist", () => receptionistA],
    ["assigned technician", () => assignedTechnicianA],
  ])("queues a server-owned checklist snapshot for %s", async (_label, actor) => {
    const before = await prisma.repairOrder.findUniqueOrThrow({ where: { id: assignedOrderId } });
    const response = await enqueue(actor(), {
      repairOrderId: assignedOrderId,
      qcTemplateId: activeTemplateId,
      phase: "QC",
    }).expect(202);
    expect(response.body.data).toMatchObject({
      capability: AiCapability.CHECKLIST_SUGGESTION,
      status: "QUEUED",
      promptVersion: "checklist-suggestion-v1",
      schemaVersion: "1",
    });
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: response.body.data.id } });
    expect(run.repairOrderId).toBe(assignedOrderId);
    expect(run.inputReference).toMatchObject({
      phase: "QC",
      deviceType: DeviceType.PHONE,
      allowedChecklistItems: itemIds.map((id) => expect.objectContaining({ id })),
    });
    const persisted = JSON.stringify(run.inputReference);
    for (const secret of [
      "0901234567",
      "private-a@example.test",
      "qc-private@example.test",
      "secret-value",
      "Private Customer",
    ]) {
      expect(persisted).not.toContain(secret);
    }
    expect(await prisma.qcRun.count({ where: { repairOrderId: assignedOrderId } })).toBe(0);
    await expect(
      prisma.repairOrder.findUniqueOrThrow({ where: { id: assignedOrderId } }),
    ).resolves.toMatchObject({ status: before.status, lockVersion: before.lockVersion });
  });

  it("enforces active assignment, tenant and active non-empty template boundaries", async () => {
    const input = {
      repairOrderId: assignedOrderId,
      qcTemplateId: activeTemplateId,
      phase: "DIAGNOSIS" as const,
    };
    await enqueue(unassignedTechnicianA, input).expect(404);
    await enqueue(assignedTechnicianA, { ...input, repairOrderId: unassignedOrderId }).expect(404);
    await enqueue(ownerA, { ...input, qcTemplateId: inactiveTemplateId }).expect(404);
    await enqueue(ownerA, { ...input, qcTemplateId: emptyTemplateId }).expect(404);
    await enqueue(ownerA, { ...input, qcTemplateId: otherTemplateId }).expect(404);
    const crossTenant = await enqueue(ownerA, input, randomUUID(), shopBId).expect(404);
    expect(crossTenant.body.error.code).toBe("SHOP_NOT_FOUND");
  });

  it("replays the same key once and rejects a changed payload", async () => {
    const key = randomUUID();
    const input = {
      repairOrderId: assignedOrderId,
      qcTemplateId: activeTemplateId,
      phase: "QC" as const,
    };
    const first = await enqueue(ownerA, input, key).expect(202);
    const replay = await enqueue(ownerA, input, key).expect(202);
    expect(replay.body.data.id).toBe(first.body.data.id);
    const mismatch = await enqueue(ownerA, { ...input, phase: "DIAGNOSIS" }, key).expect(409);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateType: "AI_RUN", aggregateId: first.body.data.id },
      }),
    ).toBe(1);
  });
});
