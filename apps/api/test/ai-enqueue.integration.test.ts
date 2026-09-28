import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AiCapability, MembershipRole, MembershipStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import type { TenantContext } from "../src/common/tenant/tenant-context.js";
import { PrismaService } from "../src/infra/database/prisma.service.js";
import { AiEnqueueService } from "../src/modules/ai/ai-enqueue.service.js";
import { AI_GLOBAL_ENABLED } from "../src/modules/ai/ai.tokens.js";

describe("AI enqueue transaction", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: AiEnqueueService;
  let tenant: TenantContext;
  let shopId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_GLOBAL_ENABLED)
      .useValue(true)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(AiEnqueueService);

    const suffix = randomUUID().slice(0, 8);
    const shop = await prisma.shop.create({
      data: { name: `RF060 enqueue ${suffix}`, slug: `rf060-enqueue-${suffix}` },
    });
    const user = await prisma.user.create({
      data: {
        email: `rf060-enqueue-${suffix}@example.test`,
        displayName: "RF060 owner",
        passwordHash: "not-used-in-direct-service-test",
      },
    });
    await prisma.shopMembership.create({
      data: {
        shopId: shop.id,
        userId: user.id,
        role: MembershipRole.OWNER,
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
      },
    });
    shopId = shop.id;
    userId = user.id;
    tenant = {
      shopId,
      userId,
      role: MembershipRole.OWNER,
      requestId: `rf060-${suffix}`,
    };
  });

  beforeEach(async () => {
    await prisma.idempotencyRecord.deleteMany({ where: { shopId } });
    await prisma.outboxEvent.deleteMany({ where: { shopId } });
    await prisma.aiRun.deleteMany({ where: { shopId } });
    await prisma.aiUsagePeriod.deleteMany({ where: { shopId } });
    await prisma.aiCapabilitySetting.upsert({
      where: { shopId_capability: { shopId, capability: AiCapability.CUSTOMER_SUMMARY } },
      update: {
        enabled: true,
        monthlyBudgetMicrousd: 1000n,
        maxRunCostMicrousd: 100n,
        lockVersion: 0,
      },
      create: {
        shopId,
        capability: AiCapability.CUSTOMER_SUMMARY,
        enabled: true,
        monthlyBudgetMicrousd: 1000n,
        maxRunCostMicrousd: 100n,
      },
    });
  });

  afterAll(async () => {
    await prisma.idempotencyRecord.deleteMany({ where: { shopId } });
    await prisma.outboxEvent.deleteMany({ where: { shopId } });
    await prisma.aiRun.deleteMany({ where: { shopId } });
    await prisma.aiUsagePeriod.deleteMany({ where: { shopId } });
    await prisma.aiCapabilitySetting.deleteMany({ where: { shopId } });
    await prisma.shopMembership.deleteMany({ where: { shopId } });
    await prisma.shop.delete({ where: { id: shopId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  function enqueue(key: string, upperBoundCostMicrousd = 60n, marker = "same") {
    return service.enqueue({
      tenant,
      capability: AiCapability.CUSTOMER_SUMMARY,
      promptVersion: "customer-summary-v1",
      schemaVersion: "1",
      inputReference: {
        marker,
        customerEmail: "pii-canary@example.test",
        notes: "Call +84 912 345 678. Technical fact remains.",
      },
      upperBoundCostMicrousd,
      idempotencyKey: key,
    });
  }

  it("creates run, budget reservation, minimal outbox and one idempotent replay", async () => {
    const key = `rf060-enqueue-${randomUUID()}`;
    const first = await enqueue(key);
    const replay = await enqueue(key);
    expect(replay).toEqual(first);

    const [runs, events, usage, records] = await Promise.all([
      prisma.aiRun.findMany({ where: { shopId } }),
      prisma.outboxEvent.findMany({ where: { shopId } }),
      prisma.aiUsagePeriod.findMany({ where: { shopId } }),
      prisma.idempotencyRecord.findMany({ where: { shopId } }),
    ]);
    expect(runs).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(records).toHaveLength(1);
    expect(usage).toHaveLength(1);
    expect(usage[0]?.reservedMicrousd).toBe(60n);
    expect(Object.keys(events[0]!.payload as object).sort()).toEqual([
      "aiRunId",
      "capability",
      "schemaVersion",
      "shopId",
    ]);
    const persisted = JSON.stringify({
      input: runs[0]!.inputReference,
      outbox: events[0]!.payload,
      response: records[0]!.responseBody,
    });
    expect(persisted).not.toContain("pii-canary");
    expect(persisted).not.toContain("912 345 678");
    expect(persisted).toContain("Technical fact remains");
  });

  it("rejects changed payload for the same idempotency key", async () => {
    const key = `rf060-mismatch-${randomUUID()}`;
    await enqueue(key, 60n, "first");
    await expect(enqueue(key, 60n, "second")).rejects.toMatchObject({
      response: { code: "IDEMPOTENCY_KEY_REUSED" },
    });
    expect(await prisma.aiRun.count({ where: { shopId } })).toBe(1);
  });

  it("serializes concurrent reservations so the monthly budget cannot be overspent", async () => {
    await prisma.aiCapabilitySetting.update({
      where: { shopId_capability: { shopId, capability: AiCapability.CUSTOMER_SUMMARY } },
      data: { monthlyBudgetMicrousd: 100n, maxRunCostMicrousd: 100n },
    });
    const outcomes = await Promise.allSettled([
      enqueue(`rf060-budget-a-${randomUUID()}`, 60n, "a"),
      enqueue(`rf060-budget-b-${randomUUID()}`, 60n, "b"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({
      reason: { response: { code: "AI_BUDGET_EXCEEDED" } },
    });
    expect(await prisma.aiRun.count({ where: { shopId } })).toBe(1);
    expect(
      (await prisma.aiUsagePeriod.findFirstOrThrow({ where: { shopId } })).reservedMicrousd,
    ).toBe(60n);
  });

  it("rolls back run, usage and idempotency when outbox insertion fails late", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `rf060_fail_outbox_${suffix}`;
    const triggerName = `rf060_fail_outbox_trigger_${suffix}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."shopId" = '${shopId}'::uuid AND NEW."eventType" = 'AI_RUN_REQUESTED_V1' THEN
          RAISE EXCEPTION 'RF060_FORCED_OUTBOX_FAILURE';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "outbox_events"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);
    try {
      await expect(enqueue(`rf060-rollback-${randomUUID()}`)).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS "${triggerName}" ON "outbox_events";
        DROP FUNCTION IF EXISTS "${functionName}"();
      `);
    }
    expect(await prisma.aiRun.count({ where: { shopId } })).toBe(0);
    expect(await prisma.aiUsagePeriod.count({ where: { shopId } })).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { shopId } })).toBe(0);
  });
});
