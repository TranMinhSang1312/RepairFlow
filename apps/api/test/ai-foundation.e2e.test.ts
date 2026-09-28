import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Prisma } from "@prisma/client";
import {
  AiCapability,
  AiReviewOutcome,
  AiRunStatus,
  DeviceType,
  MembershipRole,
  MembershipStatus,
  RepairOrderStatus,
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

interface Fixture {
  shopAId: string;
  shopBId: string;
  ownerA: Actor;
  ownerB: Actor;
  receptionistA: Actor;
  technicianA: Actor;
  inactiveOwnerA: Actor;
  assignedOrderId: string;
  unassignedOrderId: string;
  userIds: string[];
}

const CUSTOMER_SUMMARY_OUTPUT = {
  summary: "Thiết bị cần được kiểm tra thêm trước khi báo giá.",
  claimsUsed: ["finding-1"],
  warnings: [],
};

describe("RF-060 AI settings and run review API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;

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
      prisma.shop.create({ data: { name: `AI A ${suffix}`, slug: `ai-a-${suffix}` } }),
      prisma.shop.create({ data: { name: `AI B ${suffix}`, slug: `ai-b-${suffix}` } }),
    ]);
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { shopId: shopA.id, name: "Main A" } }),
      prisma.branch.create({ data: { shopId: shopB.id, name: "Main B" } }),
    ]);
    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          shopId: shopA.id,
          name: "AI Customer A",
          phoneRaw: "0900000601",
          phoneNormalized: "+84900000601",
        },
      }),
      prisma.customer.create({
        data: {
          shopId: shopB.id,
          name: "AI Customer B",
          phoneRaw: "0900000602",
          phoneNormalized: "+84900000602",
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
          model: "AI A",
        },
      }),
      prisma.device.create({
        data: {
          shopId: shopB.id,
          customerId: customerB.id,
          type: DeviceType.LAPTOP,
          brand: "Test",
          model: "AI B",
        },
      }),
    ]);

    const userSpecs = [
      ["Owner A", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopA.id],
      ["Receptionist A", MembershipRole.RECEPTIONIST, MembershipStatus.ACTIVE, shopA.id],
      ["Technician A", MembershipRole.TECHNICIAN, MembershipStatus.ACTIVE, shopA.id],
      ["Inactive Owner A", MembershipRole.OWNER, MembershipStatus.INACTIVE, shopA.id],
      ["Owner B", MembershipRole.OWNER, MembershipStatus.ACTIVE, shopB.id],
    ] as const;
    const users = await Promise.all(
      userSpecs.map(([displayName], index) =>
        prisma.user.create({
          data: {
            email: `rf060-${index}-${suffix}@example.com`,
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

    const [assignedOrder, unassignedOrder] = await Promise.all([
      prisma.repairOrder.create({
        data: {
          shopId: shopA.id,
          branchId: branchA.id,
          customerId: customerA.id,
          deviceId: deviceA.id,
          orderNo: 1,
          code: `AI-A-1-${suffix}`,
          status: RepairOrderStatus.DIAGNOSING,
          reportedProblem: "Test AI assignment boundary",
          intakeCondition: "Used condition",
          consentAcknowledgedAt: new Date(),
          customerSnapshot: { name: "AI Customer A" },
          deviceSnapshot: { type: DeviceType.PHONE, brand: "Test", model: "AI A" },
          createdByUserId: users[0]!.id,
        },
      }),
      prisma.repairOrder.create({
        data: {
          shopId: shopA.id,
          branchId: branchA.id,
          customerId: customerA.id,
          deviceId: deviceA.id,
          orderNo: 2,
          code: `AI-A-2-${suffix}`,
          status: RepairOrderStatus.DIAGNOSING,
          reportedProblem: "Test AI unassigned boundary",
          intakeCondition: "Used condition",
          consentAcknowledgedAt: new Date(),
          customerSnapshot: { name: "AI Customer A" },
          deviceSnapshot: { type: DeviceType.PHONE, brand: "Test", model: "AI A" },
          createdByUserId: users[0]!.id,
        },
      }),
    ]);
    await prisma.assignment.create({
      data: {
        shopId: shopA.id,
        repairOrderId: assignedOrder.id,
        technicianUserId: users[2]!.id,
        assignedByUserId: users[0]!.id,
      },
    });

    const actor = (index: number): Actor => ({
      userId: users[index]!.id,
      token: tokenService.createAccessToken(users[index]!.id).token,
    });
    fixture = {
      shopAId: shopA.id,
      shopBId: shopB.id,
      ownerA: actor(0),
      receptionistA: actor(1),
      technicianA: actor(2),
      inactiveOwnerA: actor(3),
      ownerB: actor(4),
      assignedOrderId: assignedOrder.id,
      unassignedOrderId: unassignedOrder.id,
      userIds: users.map((user) => user.id),
    };

    // Keep the second tenant's branch and device reachable until cleanup.
    expect(branchB.shopId).toBe(shopB.id);
    expect(deviceB.shopId).toBe(shopB.id);
  });

  afterAll(async () => {
    const shopIds = [fixture.shopAId, fixture.shopBId];
    await prisma.aiRun.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.aiUsagePeriod.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.aiCapabilitySetting.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.auditLog.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.outboxEvent.deleteMany({ where: { shopId: { in: shopIds } } });
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

  function authenticated(actor: Actor, shopId = fixture.shopAId) {
    return {
      settings: () =>
        request(app.getHttpServer())
          .get("/api/v1/settings/ai")
          .set("Authorization", `Bearer ${actor.token}`)
          .set("X-Shop-Id", shopId),
      updateSetting: (
        capability: AiCapability,
        body: {
          enabled: boolean;
          monthlyBudgetMicrousd: string;
          maxRunCostMicrousd: string;
          expectedLockVersion: number;
        },
      ) =>
        request(app.getHttpServer())
          .patch(`/api/v1/settings/ai/${capability}`)
          .set("Authorization", `Bearer ${actor.token}`)
          .set("X-Shop-Id", shopId)
          .send(body),
      run: (runId: string) =>
        request(app.getHttpServer())
          .get(`/api/v1/ai/runs/${runId}`)
          .set("Authorization", `Bearer ${actor.token}`)
          .set("X-Shop-Id", shopId),
      review: (runId: string, body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post(`/api/v1/ai/runs/${runId}/review`)
          .set("Authorization", `Bearer ${actor.token}`)
          .set("X-Shop-Id", shopId)
          .send(body),
    };
  }

  function createRun(options?: {
    shopId?: string;
    requestedByUserId?: string;
    repairOrderId?: string | null;
    status?: AiRunStatus;
    output?: Record<string, unknown> | null;
  }) {
    const status = options?.status ?? AiRunStatus.SUCCEEDED;
    const shopId = options?.shopId ?? fixture.shopAId;
    const output =
      options?.output === undefined
        ? status === AiRunStatus.SUCCEEDED
          ? CUSTOMER_SUMMARY_OUTPUT
          : null
        : options.output;
    return prisma.aiRun.create({
      data: {
        shopId,
        repairOrderId:
          options?.repairOrderId === undefined ? fixture.assignedOrderId : options.repairOrderId,
        capability: AiCapability.CUSTOMER_SUMMARY,
        status,
        provider: "deepseek",
        model: "provider-model-must-not-leak",
        promptVersion: "customer-summary-v1",
        schemaVersion: "1",
        inputReference: { marker: "private-input-reference-must-not-leak" },
        ...(output === null ? {} : { output: output as Prisma.InputJsonValue }),
        ...(status === AiRunStatus.SUCCEEDED ? { confidence: 0.9 } : {}),
        requestedByUserId:
          options?.requestedByUserId ??
          (shopId === fixture.shopBId ? fixture.ownerB.userId : fixture.ownerA.userId),
        inputTokens: 101,
        outputTokens: 23,
        reservedCostMicrousd: 900n,
        estimatedCostMicrousd: 450n,
        priceTableVersion: "deepseek-price-v1",
        latencyMs: 125,
        ...(status === AiRunStatus.QUEUED ? {} : { startedAt: new Date() }),
        ...(status === AiRunStatus.SUCCEEDED || status === AiRunStatus.FAILED
          ? { completedAt: new Date() }
          : {}),
      },
    });
  }

  it("returns disabled defaults and lets only the owner create a versioned setting", async () => {
    const initial = await authenticated(fixture.ownerA).settings().expect(200);
    expect(initial.body.data).toMatchObject({ globalEnabled: true });
    expect(initial.body.data.capabilities).toHaveLength(Object.values(AiCapability).length);
    expect(initial.body.data.capabilities).toEqual(
      expect.arrayContaining(
        Object.values(AiCapability).map((capability) =>
          expect.objectContaining({
            capability,
            enabled: false,
            effectiveEnabled: false,
            monthlyBudgetMicrousd: "0",
            maxRunCostMicrousd: "0",
            lockVersion: 0,
            updatedAt: null,
          }),
        ),
      ),
    );

    const updated = await authenticated(fixture.ownerA)
      .updateSetting(AiCapability.DEVICE_OCR, {
        enabled: true,
        monthlyBudgetMicrousd: "5000000",
        maxRunCostMicrousd: "250000",
        expectedLockVersion: 0,
      })
      .expect(200);
    expect(updated.body.data.capabilities).toContainEqual(
      expect.objectContaining({
        capability: AiCapability.DEVICE_OCR,
        enabled: true,
        effectiveEnabled: true,
        monthlyBudgetMicrousd: "5000000",
        maxRunCostMicrousd: "250000",
        lockVersion: 1,
      }),
    );
    expect(JSON.stringify(updated.body)).not.toMatch(/api.?key|deepseek|secret/iu);

    await authenticated(fixture.receptionistA).settings().expect(403);
    await authenticated(fixture.technicianA).settings().expect(403);
    await authenticated(fixture.inactiveOwnerA).settings().expect(403);
    const crossTenant = await authenticated(fixture.ownerA, fixture.shopBId).settings().expect(404);
    expect(crossTenant.body.error.code).toBe("SHOP_NOT_FOUND");
  });

  it("allows exactly one concurrent setting update for the expected version", async () => {
    const body = {
      enabled: true,
      monthlyBudgetMicrousd: "6000000",
      maxRunCostMicrousd: "300000",
      expectedLockVersion: 1,
    };
    const [first, second] = await Promise.all([
      authenticated(fixture.ownerA).updateSetting(AiCapability.DEVICE_OCR, body),
      authenticated(fixture.ownerA).updateSetting(AiCapability.DEVICE_OCR, {
        ...body,
        monthlyBudgetMicrousd: "7000000",
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect([first, second].find((response) => response.status === 409)?.body.error.code).toBe(
      "AI_SETTING_VERSION_CONFLICT",
    );
    const persisted = await prisma.aiCapabilitySetting.findUniqueOrThrow({
      where: {
        shopId_capability: {
          shopId: fixture.shopAId,
          capability: AiCapability.DEVICE_OCR,
        },
      },
    });
    expect(persisted.lockVersion).toBe(2);
    expect([6000000n, 7000000n]).toContain(persisted.monthlyBudgetMicrousd);
  });

  it("isolates run reads by tenant and active technician assignment", async () => {
    const assigned = await createRun();
    const unassigned = await createRun({ repairOrderId: fixture.unassignedOrderId });
    const otherTenant = await createRun({
      shopId: fixture.shopBId,
      requestedByUserId: fixture.ownerB.userId,
      repairOrderId: null,
    });

    const ownerView = await authenticated(fixture.ownerA).run(assigned.id).expect(200);
    await authenticated(fixture.receptionistA).run(assigned.id).expect(200);
    await authenticated(fixture.technicianA).run(assigned.id).expect(200);
    const deniedUnassigned = await authenticated(fixture.technicianA)
      .run(unassigned.id)
      .expect(404);
    expect(deniedUnassigned.body.error.code).toBe("RESOURCE_NOT_FOUND");

    const crossTenant = await authenticated(fixture.ownerA).run(otherTenant.id).expect(404);
    const missing = await authenticated(fixture.ownerA).run(randomUUID()).expect(404);
    expect(crossTenant.body.error).toMatchObject({
      code: missing.body.error.code,
      message: missing.body.error.message,
    });

    expect(ownerView.body.data).toMatchObject({
      id: assigned.id,
      capability: AiCapability.CUSTOMER_SUMMARY,
      status: AiRunStatus.SUCCEEDED,
      promptVersion: "customer-summary-v1",
      schemaVersion: "1",
      output: CUSTOMER_SUMMARY_OUTPUT,
      review: null,
    });
    for (const privateField of [
      "inputReference",
      "provider",
      "model",
      "inputTokens",
      "outputTokens",
      "reservedCostMicrousd",
      "estimatedCostMicrousd",
      "priceTableVersion",
      "latencyMs",
    ]) {
      expect(ownerView.body.data).not.toHaveProperty(privateField);
    }
    expect(JSON.stringify(ownerView.body)).not.toContain("private-input-reference-must-not-leak");
    expect(JSON.stringify(ownerView.body)).not.toContain("provider-model-must-not-leak");
  });

  it("records an unchanged acceptance once without mutating the domain order", async () => {
    const run = await createRun();
    const orderBefore = await prisma.repairOrder.findUniqueOrThrow({
      where: { id: fixture.assignedOrderId },
    });
    const reviewed = await authenticated(fixture.ownerA)
      .review(run.id, {
        outcome: AiReviewOutcome.ACCEPTED_UNCHANGED,
        reviewedOutput: run.output,
        timeSavedSeconds: 90,
      })
      .expect(200);
    expect(reviewed.body.data.review).toMatchObject({
      outcome: AiReviewOutcome.ACCEPTED_UNCHANGED,
      editDistancePermille: 0,
      timeSavedSeconds: 90,
    });

    const persisted = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(persisted).toMatchObject({
      status: AiRunStatus.SUCCEEDED,
      reviewOutcome: AiReviewOutcome.ACCEPTED_UNCHANGED,
      reviewedByUserId: fixture.ownerA.userId,
      acceptedByUserId: fixture.ownerA.userId,
      editDistancePermille: 0,
      timeSavedSeconds: 90,
    });
    expect(persisted.reviewedAt).not.toBeNull();
    expect(persisted.acceptedAt).not.toBeNull();
    await expect(
      prisma.repairOrder.findUniqueOrThrow({ where: { id: fixture.assignedOrderId } }),
    ).resolves.toMatchObject({
      status: orderBefore.status,
      lockVersion: orderBefore.lockVersion,
    });

    const replay = await authenticated(fixture.ownerA)
      .review(run.id, {
        outcome: AiReviewOutcome.ACCEPTED_UNCHANGED,
        reviewedOutput: run.output,
      })
      .expect(409);
    expect(replay.body.error.code).toBe("AI_DRAFT_ALREADY_APPLIED");
  });

  it("computes edited telemetry and discards the reviewed output", async () => {
    const run = await createRun();
    const editedMarker = `Edited draft ${randomUUID()} must not persist`;
    const editedOutput = { ...(run.output as Record<string, unknown>), summary: editedMarker };
    const reviewed = await authenticated(fixture.receptionistA)
      .review(run.id, {
        outcome: AiReviewOutcome.ACCEPTED_EDITED,
        reviewedOutput: editedOutput,
        timeSavedSeconds: 45,
      })
      .expect(200);
    expect(reviewed.body.data.review).toMatchObject({
      outcome: AiReviewOutcome.ACCEPTED_EDITED,
      timeSavedSeconds: 45,
    });
    expect(reviewed.body.data.review.editDistancePermille).toBeGreaterThan(0);

    const persisted = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(persisted.output).toEqual(run.output);
    expect(persisted.acceptedByUserId).toBe(fixture.receptionistA.userId);
    expect(
      JSON.stringify(persisted, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain(editedMarker);
  });

  it("records rejection without acceptance data and retains the original draft", async () => {
    const run = await createRun();
    const reviewed = await authenticated(fixture.ownerA)
      .review(run.id, { outcome: AiReviewOutcome.REJECTED })
      .expect(200);
    expect(reviewed.body.data).toMatchObject({
      status: AiRunStatus.REJECTED,
      output: run.output,
      review: {
        outcome: AiReviewOutcome.REJECTED,
        editDistancePermille: null,
        timeSavedSeconds: null,
      },
    });

    const persisted = await prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(persisted).toMatchObject({
      status: AiRunStatus.REJECTED,
      reviewOutcome: AiReviewOutcome.REJECTED,
      reviewedByUserId: fixture.ownerA.userId,
      acceptedByUserId: null,
      acceptedAt: null,
      editDistancePermille: null,
      timeSavedSeconds: null,
    });
    expect(persisted.output).toEqual(run.output);
  });

  it("rejects invalid reviewed output and non-successful runs without persisting review data", async () => {
    const successful = await createRun();
    const invalid = await authenticated(fixture.ownerA)
      .review(successful.id, {
        outcome: AiReviewOutcome.ACCEPTED_EDITED,
        reviewedOutput: { summary: "Missing required fields" },
      })
      .expect(422);
    expect(invalid.body.error.code).toBe("VALIDATION_FAILED");

    const queued = await createRun({ status: AiRunStatus.QUEUED, output: null });
    const notReviewable = await authenticated(fixture.ownerA)
      .review(queued.id, {
        outcome: AiReviewOutcome.ACCEPTED_UNCHANGED,
        reviewedOutput: CUSTOMER_SUMMARY_OUTPUT,
      })
      .expect(409);
    expect(notReviewable.body.error.code).toBe("AI_RUN_NOT_REVIEWABLE");

    const [successfulPersisted, queuedPersisted] = await Promise.all([
      prisma.aiRun.findUniqueOrThrow({ where: { id: successful.id } }),
      prisma.aiRun.findUniqueOrThrow({ where: { id: queued.id } }),
    ]);
    expect(successfulPersisted.reviewOutcome).toBeNull();
    expect(successfulPersisted.reviewedByUserId).toBeNull();
    expect(queuedPersisted.reviewOutcome).toBeNull();
    expect(queuedPersisted.reviewedByUserId).toBeNull();
  });
});
