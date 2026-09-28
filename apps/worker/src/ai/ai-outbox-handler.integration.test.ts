import { AiCapability, AiRunStatus, MembershipRole, MembershipStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../database.js";
import type { ClaimedOutboxEvent } from "../outbox/outbox.types.js";
import {
  AiCapabilityRegistry,
  AI_PROMPT_VERSION,
  AI_SCHEMA_VERSION,
} from "./ai-capability-registry.js";
import { AiGatewayError } from "./ai-errors.js";
import type { AiGateway, AiGatewayRequest, AiGatewayResult } from "./ai-gateway.js";
import { AiOutboxHandler } from "./ai-outbox-handler.js";
import { AI_RUN_REQUESTED_EVENT } from "./ai-outbox-repository.js";
import { AiPriceCalculator } from "./ai-price-calculator.js";
import { CircuitBreaker } from "./circuit-breaker.js";

loadWorkspaceEnvironment();

const NOW = new Date("2026-09-28T12:00:00.000Z");
const PERIOD_START = new Date("2026-09-01T00:00:00.000Z");
const VALID_OUTPUT = {
  summary: "Pin đã xuống cấp.",
  claimsUsed: ["Pin đã chai"],
  warnings: [],
};

class ScriptedGateway implements AiGateway {
  readonly provider = "fake";
  readonly model = "fake-v1";
  readonly requests: AiGatewayRequest[] = [];

  constructor(
    private readonly script:
      | AiGatewayResult
      | Error
      | ((request: AiGatewayRequest) => AiGatewayResult | Promise<AiGatewayResult>),
  ) {}

  async generate(request: AiGatewayRequest): Promise<AiGatewayResult> {
    this.requests.push(request);
    if (this.script instanceof Error) throw this.script;
    return typeof this.script === "function" ? this.script(request) : this.script;
  }
}

describe("AI outbox handler", () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for AI worker integration tests.");
  const prisma = createPrismaClient(databaseUrl);
  const shopIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(() => prisma.$connect());

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.aiRun.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.aiUsagePeriod.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.aiCapabilitySetting.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    shopIds.splice(0);
    userIds.splice(0);
  });

  afterAll(() => prisma.$disconnect());

  async function createFixture(input?: {
    status?: AiRunStatus;
    settingEnabled?: boolean;
    createUsage?: boolean;
    inputReference?: Record<string, unknown>;
  }) {
    const suffix = randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: {
        email: `rf060-worker-${suffix}@example.test`,
        passwordHash: "not-a-real-password-hash",
        displayName: `RF060 ${suffix}`,
      },
    });
    const shop = await prisma.shop.create({
      data: { name: `RF060 ${suffix}`, slug: `rf060-ai-${suffix}` },
    });
    userIds.push(user.id);
    shopIds.push(shop.id);
    await prisma.aiCapabilitySetting.create({
      data: {
        shopId: shop.id,
        capability: AiCapability.CUSTOMER_SUMMARY,
        enabled: input?.settingEnabled ?? true,
        monthlyBudgetMicrousd: 1_000n,
        maxRunCostMicrousd: 100n,
      },
    });
    await prisma.shopMembership.create({
      data: {
        shopId: shop.id,
        userId: user.id,
        role: MembershipRole.OWNER,
        status: MembershipStatus.ACTIVE,
        joinedAt: NOW,
      },
    });
    if (input?.createUsage !== false) {
      await prisma.aiUsagePeriod.create({
        data: {
          shopId: shop.id,
          capability: AiCapability.CUSTOMER_SUMMARY,
          periodStart: PERIOD_START,
          reservedMicrousd: 100n,
        },
      });
    }
    const run = await prisma.aiRun.create({
      data: {
        shopId: shop.id,
        capability: AiCapability.CUSTOMER_SUMMARY,
        status: input?.status ?? AiRunStatus.QUEUED,
        provider: input?.status === AiRunStatus.RUNNING ? "fake" : null,
        model: input?.status === AiRunStatus.RUNNING ? "fake-v1" : null,
        promptVersion: AI_PROMPT_VERSION,
        schemaVersion: AI_SCHEMA_VERSION,
        inputReference: (input?.inputReference ?? {
          approvedFacts: ["Pin đã chai"],
          customerEmail: "private-customer@example.test",
        }) as Prisma.InputJsonObject,
        requestedByUserId: user.id,
        reservedCostMicrousd: 100n,
        createdAt: NOW,
        ...(input?.status === AiRunStatus.RUNNING ? { startedAt: NOW } : {}),
      },
    });
    const event = await prisma.outboxEvent.create({
      data: {
        shopId: shop.id,
        eventType: AI_RUN_REQUESTED_EVENT,
        aggregateType: "AI_RUN",
        aggregateId: run.id,
        payload: {
          schemaVersion: 1,
          aiRunId: run.id,
          shopId: shop.id,
          capability: AiCapability.CUSTOMER_SUMMARY,
        },
      },
    });
    return {
      run,
      event: {
        ...event,
        lockedAt: NOW,
        lockedBy: "ai-worker",
        notifications: [],
      } satisfies ClaimedOutboxEvent,
    };
  }

  function successResult(output: unknown = VALID_OUTPUT): AiGatewayResult {
    return {
      provider: "fake",
      model: "fake-v1",
      output,
      usage: { inputTokens: 10, outputTokens: 5 },
      latencyMs: 25,
    };
  }

  function handler(gateway: AiGateway, globalEnabled = true) {
    return new AiOutboxHandler(
      prisma,
      gateway,
      new AiCapabilityRegistry(),
      new AiPriceCalculator({
        version: "test-v1",
        provider: "fake",
        model: "fake-v1",
        inputPriceMicrousdPerMillionTokens: 1_000_000n,
        outputPriceMicrousdPerMillionTokens: 2_000_000n,
      }),
      new CircuitBreaker({ provider: "fake", failureThreshold: 2, cooldownMs: 30_000 }),
      { globalEnabled, timeoutMs: 1_000, maxOutputBytes: 4_096 },
    );
  }

  it("persists a valid draft, redacts provider input, and reconciles actual cost", async () => {
    const fixture = await createFixture();
    const gateway = new ScriptedGateway(successResult());
    await handler(gateway).handle(fixture.event, NOW);

    expect(JSON.stringify(gateway.requests[0]!.input)).not.toContain(
      "private-customer@example.test",
    );
    expect(await prisma.aiRun.findUniqueOrThrow({ where: { id: fixture.run.id } })).toMatchObject({
      status: AiRunStatus.SUCCEEDED,
      provider: "fake",
      model: "fake-v1",
      output: VALID_OUTPUT,
      errorCode: null,
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostMicrousd: 20n,
      priceTableVersion: "test-v1",
      latencyMs: 25,
      completedAt: NOW,
    });
    await expect(
      prisma.aiUsagePeriod.findUniqueOrThrow({
        where: {
          shopId_capability_periodStart: {
            shopId: fixture.run.shopId,
            capability: fixture.run.capability,
            periodStart: PERIOD_START,
          },
        },
      }),
    ).resolves.toMatchObject({ reservedMicrousd: 0n, spentMicrousd: 20n });
  });

  it("persists an unavailable provider as a terminal run and returns normally", async () => {
    const fixture = await createFixture();
    const gateway = new ScriptedGateway(
      new AiGatewayError("AI_PROVIDER_RATE_LIMITED", {
        provider: "fake",
        model: "fake-v1",
        outcome: "NOT_STARTED",
        retryDisposition: "SAFE_BEFORE_INFERENCE",
        statusCode: 429,
      }),
    );
    await expect(handler(gateway).handle(fixture.event, NOW)).resolves.toBeUndefined();
    await expect(
      prisma.aiRun.findUniqueOrThrow({ where: { id: fixture.run.id } }),
    ).resolves.toMatchObject({
      status: AiRunStatus.FAILED,
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      output: null,
      estimatedCostMicrousd: 0n,
    });
    await expect(
      prisma.aiUsagePeriod.findUniqueOrThrow({
        where: {
          shopId_capability_periodStart: {
            shopId: fixture.run.shopId,
            capability: fixture.run.capability,
            periodStart: PERIOD_START,
          },
        },
      }),
    ).resolves.toMatchObject({ reservedMicrousd: 0n, spentMicrousd: 0n });
  });

  it("does not call the provider for a recovered RUNNING run and charges its reservation", async () => {
    const fixture = await createFixture({ status: AiRunStatus.RUNNING });
    const gateway = new ScriptedGateway(successResult());
    await handler(gateway).handle(fixture.event, NOW);
    expect(gateway.requests).toHaveLength(0);
    await expect(
      prisma.aiRun.findUniqueOrThrow({ where: { id: fixture.run.id } }),
    ).resolves.toMatchObject({
      status: AiRunStatus.FAILED,
      errorCode: "AI_PROVIDER_OUTCOME_UNKNOWN",
      estimatedCostMicrousd: 100n,
    });
    await expect(
      prisma.aiUsagePeriod.findUniqueOrThrow({
        where: {
          shopId_capability_periodStart: {
            shopId: fixture.run.shopId,
            capability: fixture.run.capability,
            periodStart: PERIOD_START,
          },
        },
      }),
    ).resolves.toMatchObject({ reservedMicrousd: 0n, spentMicrousd: 100n });
  });

  it("rejects invalid provider output without storing it or calling again on replay", async () => {
    const fixture = await createFixture();
    const gateway = new ScriptedGateway(successResult({ summary: "missing required fields" }));
    const worker = handler(gateway);
    await worker.handle(fixture.event, NOW);
    await worker.handle(fixture.event, new Date(NOW.getTime() + 1_000));
    expect(gateway.requests).toHaveLength(1);
    await expect(
      prisma.aiRun.findUniqueOrThrow({ where: { id: fixture.run.id } }),
    ).resolves.toMatchObject({
      status: AiRunStatus.FAILED,
      errorCode: "AI_OUTPUT_INVALID",
      output: null,
      estimatedCostMicrousd: 20n,
    });
  });

  it("rechecks both global and shop feature flags before provider dispatch", async () => {
    const shopDisabled = await createFixture({ settingEnabled: false });
    const globalDisabled = await createFixture();
    const gateway = new ScriptedGateway(successResult());
    await handler(gateway).handle(shopDisabled.event, NOW);
    await handler(gateway, false).handle(globalDisabled.event, NOW);
    expect(gateway.requests).toHaveLength(0);
    const runs = await prisma.aiRun.findMany({
      where: { id: { in: [shopDisabled.run.id, globalDisabled.run.id] } },
      orderBy: { id: "asc" },
    });
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === AiRunStatus.FAILED)).toBe(true);
    expect(runs.every((run) => run.errorCode === "AI_FEATURE_DISABLED")).toBe(true);
  });

  it("releases the reservation and skips the provider when requester access was revoked", async () => {
    const fixture = await createFixture();
    await prisma.shopMembership.update({
      where: {
        shopId_userId: {
          shopId: fixture.run.shopId,
          userId: fixture.run.requestedByUserId,
        },
      },
      data: { status: MembershipStatus.INACTIVE },
    });
    const gateway = new ScriptedGateway(successResult());

    await handler(gateway).handle(fixture.event, NOW);

    expect(gateway.requests).toHaveLength(0);
    await expect(
      prisma.aiRun.findUniqueOrThrow({ where: { id: fixture.run.id } }),
    ).resolves.toMatchObject({
      status: AiRunStatus.FAILED,
      errorCode: "AI_AUTHORIZATION_REVOKED",
      output: null,
      estimatedCostMicrousd: 0n,
    });
    await expect(
      prisma.aiUsagePeriod.findUniqueOrThrow({
        where: {
          shopId_capability_periodStart: {
            shopId: fixture.run.shopId,
            capability: fixture.run.capability,
            periodStart: PERIOD_START,
          },
        },
      }),
    ).resolves.toMatchObject({ reservedMicrousd: 0n, spentMicrousd: 0n });
  });

  it("throws a database invariant failure instead of hiding it as a provider failure", async () => {
    const fixture = await createFixture({ createUsage: false });
    const gateway = new ScriptedGateway(successResult());
    await expect(handler(gateway).handle(fixture.event, NOW)).rejects.toThrow(
      "AI_BUDGET_RESERVATION_MISSING",
    );
    await expect(
      prisma.aiRun.findUniqueOrThrow({ where: { id: fixture.run.id } }),
    ).resolves.toMatchObject({ status: AiRunStatus.RUNNING, completedAt: null });
  });
});
