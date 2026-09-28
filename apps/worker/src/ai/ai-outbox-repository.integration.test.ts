import { OutboxStatus } from "@prisma/client";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../database.js";
import {
  AI_RUN_REQUESTED_EVENT,
  AiOutboxRepository,
  type AiOutboxWorkerOptions,
} from "./ai-outbox-repository.js";

loadWorkspaceEnvironment();

const options: AiOutboxWorkerOptions = {
  batchSize: 10,
  leaseMs: 30_000,
  maxAttempts: 3,
  retryBaseMs: 1_000,
  retryMaxMs: 10_000,
};

describe("AI outbox repository", () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for AI worker integration tests.");
  const firstClient = createPrismaClient(databaseUrl);
  const secondClient = createPrismaClient(databaseUrl);
  const firstRepository = new AiOutboxRepository(firstClient);
  const secondRepository = new AiOutboxRepository(secondClient);
  const shopIds: string[] = [];

  beforeAll(async () => {
    await Promise.all([firstClient.$connect(), secondClient.$connect()]);
  });

  afterEach(async () => {
    await firstClient.outboxEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await firstClient.shop.deleteMany({ where: { id: { in: shopIds } } });
    shopIds.splice(0);
  });

  afterAll(async () => {
    await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
  });

  async function createEvent(eventType = AI_RUN_REQUESTED_EVENT) {
    const suffix = randomUUID().slice(0, 8);
    const shop = await firstClient.shop.create({
      data: { name: `RF060 ${suffix}`, slug: `rf060-worker-${suffix}` },
    });
    shopIds.push(shop.id);
    const event = await firstClient.outboxEvent.create({
      data: {
        shopId: shop.id,
        eventType,
        aggregateType: "AI_RUN",
        aggregateId: randomUUID(),
        payload: { schemaVersion: 1 },
        availableAt: new Date("2026-09-28T00:00:00.000Z"),
      },
    });
    return { event, shop };
  }

  it("claims an AI event without NotificationDelivery exactly once across workers", async () => {
    const { event } = await createEvent();
    const now = new Date("2026-09-28T01:00:00.000Z");
    const [first, second] = await Promise.all([
      firstRepository.claimBatch("ai-worker-a", now, options),
      secondRepository.claimBatch("ai-worker-b", now, options),
    ]);
    const claimed = [...first, ...second];
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      id: event.id,
      attempts: 1,
      notifications: [],
    });
  });

  it("does not claim a notification or unrelated outbox event", async () => {
    await createEvent("QUOTE_SENT");
    await expect(
      firstRepository.claimBatch("ai-worker", new Date("2026-09-28T01:00:00.000Z"), options),
    ).resolves.toEqual([]);
  });

  it("reclaims an expired lease and dead-letters it at the attempt limit", async () => {
    const { event } = await createEvent();
    await firstClient.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: OutboxStatus.PROCESSING,
        attempts: options.maxAttempts,
        lockedAt: new Date("2026-09-28T00:00:00.000Z"),
        lockedBy: "dead-worker",
      },
    });
    await expect(
      firstRepository.claimBatch("ai-worker", new Date("2026-09-28T01:00:00.000Z"), options),
    ).resolves.toEqual([]);
    await expect(
      firstClient.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toMatchObject({
      status: OutboxStatus.DEAD_LETTER,
      lastError: "LEASE_EXPIRED",
      lockedAt: null,
      lockedBy: null,
    });
  });
});
