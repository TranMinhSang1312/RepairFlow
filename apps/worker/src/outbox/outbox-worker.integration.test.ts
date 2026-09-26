import { NotificationChannel, NotificationStatus, OutboxStatus } from "@prisma/client";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../database.js";
import type { NotificationMessageResolver } from "./notification-message-resolver.js";
import type { NotificationMessage, NotificationProvider } from "./notification-provider.js";
import { NotificationOutboxHandler } from "./notification-outbox-handler.js";
import { OutboxDeliveryError } from "./outbox-errors.js";
import { OutboxProcessor } from "./outbox-processor.js";
import { OutboxRepository } from "./outbox-repository.js";
import type { OutboxWorkerOptions, WorkerLogger } from "./outbox.types.js";

loadWorkspaceEnvironment();

const options: OutboxWorkerOptions = {
  eventTypes: ["RF050_NOTIFICATION_TEST"],
  notificationChannels: [NotificationChannel.EMAIL],
  batchSize: 10,
  leaseMs: 30000,
  maxAttempts: 3,
  retryBaseMs: 1000,
  retryMaxMs: 10000,
};

const staticResolver: NotificationMessageResolver = {
  resolve: (event, delivery) =>
    Promise.resolve({
      outboxEventId: event.id,
      notificationDeliveryId: delivery.id,
      channel: "EMAIL",
      idempotencyKey: `outbox:${event.id}:notification:${delivery.id}`,
      to: "snapshot@example.test",
      subject: "Test message",
      text: "Test message",
      html: "<p>Test message</p>",
    }),
};

class CapturingLogger implements WorkerLogger {
  readonly entries: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];

  debug(fields: Record<string, unknown>, message: string): void {
    this.entries.push({ level: "debug", fields, message });
  }

  info(fields: Record<string, unknown>, message: string): void {
    this.entries.push({ level: "info", fields, message });
  }

  warn(fields: Record<string, unknown>, message: string): void {
    this.entries.push({ level: "warn", fields, message });
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.entries.push({ level: "error", fields, message });
  }
}

class ScriptedProvider implements NotificationProvider {
  readonly messages: NotificationMessage[] = [];

  constructor(private failuresRemaining = 0) {}

  deliver(message: NotificationMessage): Promise<{ providerMessageId: string }> {
    this.messages.push(message);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new OutboxDeliveryError("EMAIL_TEMPORARY_FAILURE");
    }
    return Promise.resolve({ providerMessageId: `provider:${message.idempotencyKey}` });
  }
}

describe("PostgreSQL outbox worker", () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error("DATABASE_URL is required for outbox worker integration tests.");
  const firstClient = createPrismaClient(databaseUrl);
  const secondClient = createPrismaClient(databaseUrl);
  const firstRepository = new OutboxRepository(firstClient);
  const secondRepository = new OutboxRepository(secondClient);
  const shopIds: string[] = [];

  beforeAll(async () => {
    await Promise.all([firstClient.$connect(), secondClient.$connect()]);
  });

  afterEach(async () => {
    await firstClient.notificationDelivery.deleteMany({
      where: { outboxEvent: { shopId: { in: shopIds } } },
    });
    await firstClient.outboxEvent.deleteMany({ where: { shopId: { in: shopIds } } });
    await firstClient.shop.deleteMany({ where: { id: { in: shopIds } } });
    shopIds.splice(0);
  });

  afterAll(async () => {
    await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
  });

  async function createOutboxFixture(input?: {
    withDelivery?: boolean;
    status?: OutboxStatus;
    attempts?: number;
    availableAt?: Date;
    lockedAt?: Date | null;
    lockedBy?: string | null;
    deliveryStatus?: NotificationStatus;
    deliveryChannel?: NotificationChannel;
  }) {
    const suffix = randomUUID().slice(0, 8);
    const shop = await firstClient.shop.create({
      data: { name: `RF050 ${suffix}`, slug: `rf050-${suffix}` },
    });
    shopIds.push(shop.id);
    const withDelivery = input?.withDelivery ?? true;
    const event = await firstClient.outboxEvent.create({
      data: {
        shopId: shop.id,
        eventType: "RF050_NOTIFICATION_TEST",
        aggregateType: "QUOTE_VERSION",
        aggregateId: randomUUID(),
        payload: { marker: "sensitive-payload-must-not-be-logged" },
        status: input?.status ?? OutboxStatus.PENDING,
        attempts: input?.attempts ?? 0,
        availableAt: input?.availableAt ?? new Date("2026-09-26T00:00:00.000Z"),
        ...(input?.lockedAt !== undefined ? { lockedAt: input.lockedAt } : {}),
        ...(input?.lockedBy !== undefined ? { lockedBy: input.lockedBy } : {}),
        ...(withDelivery
          ? {
              notifications: {
                create: {
                  channel: input?.deliveryChannel ?? NotificationChannel.EMAIL,
                  destinationHash: "0".repeat(64),
                  status: input?.deliveryStatus ?? NotificationStatus.PENDING,
                  ...(input?.deliveryStatus === NotificationStatus.SENT
                    ? {
                        attempts: 1,
                        providerMessageId: `already-sent:${suffix}`,
                        sentAt: new Date("2026-09-26T00:00:00.000Z"),
                      }
                    : {}),
                },
              },
            }
          : {}),
      },
      include: { notifications: true },
    });
    return { shop, event };
  }

  it("uses SKIP LOCKED so two workers cannot claim the same event", async () => {
    await createOutboxFixture();
    const now = new Date("2026-09-26T01:00:00.000Z");
    const [first, second] = await Promise.all([
      firstRepository.claimBatch("worker-a", now, { ...options, batchSize: 1 }),
      secondRepository.claimBatch("worker-b", now, { ...options, batchSize: 1 }),
    ]);
    const claimed = [...first, ...second];
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ attempts: 1, notifications: [{ channel: "EMAIL" }] });
    expect(["worker-a", "worker-b"]).toContain(claimed[0]!.lockedBy);
  });

  it("retries with bounded backoff, uses a stable provider key, and completes once", async () => {
    const { event } = await createOutboxFixture();
    const provider = new ScriptedProvider(2);
    const logger = new CapturingLogger();
    let now = new Date("2026-09-26T02:00:00.000Z");
    const processor = new OutboxProcessor(
      firstRepository,
      new NotificationOutboxHandler(firstRepository, staticResolver, provider),
      logger,
      "worker-retry",
      options,
      () => now,
    );

    expect(await processor.runOnce()).toMatchObject({ retried: 1 });
    let stored = await firstClient.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored).toMatchObject({ status: OutboxStatus.FAILED, attempts: 1 });
    expect(stored.availableAt.toISOString()).toBe("2026-09-26T02:00:01.000Z");

    now = stored.availableAt;
    expect(await processor.runOnce()).toMatchObject({ retried: 1 });
    stored = await firstClient.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored).toMatchObject({ status: OutboxStatus.FAILED, attempts: 2 });
    expect(stored.availableAt.toISOString()).toBe("2026-09-26T02:00:03.000Z");

    now = stored.availableAt;
    expect(await processor.runOnce()).toMatchObject({ completed: 1 });
    stored = await firstClient.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    const delivery = await firstClient.notificationDelivery.findFirstOrThrow({
      where: { outboxEventId: event.id },
    });
    expect(stored).toMatchObject({ status: OutboxStatus.COMPLETED, attempts: 3 });
    expect(delivery).toMatchObject({ status: NotificationStatus.SENT, attempts: 3 });
    expect(new Set(provider.messages.map((message) => message.idempotencyKey)).size).toBe(1);
    expect(JSON.stringify(logger.entries)).not.toContain("sensitive-payload-must-not-be-logged");
  });

  it("moves a repeatedly failing event to dead letter at the configured limit", async () => {
    const { event } = await createOutboxFixture();
    const provider = new ScriptedProvider(10);
    let now = new Date("2026-09-26T03:00:00.000Z");
    const processor = new OutboxProcessor(
      firstRepository,
      new NotificationOutboxHandler(firstRepository, staticResolver, provider),
      new CapturingLogger(),
      "worker-dead-letter",
      { ...options, maxAttempts: 2 },
      () => now,
    );

    expect(await processor.runOnce()).toMatchObject({ retried: 1, deadLettered: 0 });
    now = (await firstClient.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }))
      .availableAt;
    expect(await processor.runOnce()).toMatchObject({ retried: 0, deadLettered: 1 });
    expect(
      await firstClient.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).toMatchObject({
      status: OutboxStatus.DEAD_LETTER,
      attempts: 2,
      lockedAt: null,
      lockedBy: null,
      lastError: "EMAIL_TEMPORARY_FAILURE",
    });
  });

  it("reclaims an expired lease but leaves domain-only events pending", async () => {
    const now = new Date("2026-09-26T04:00:00.000Z");
    const stale = await createOutboxFixture({
      status: OutboxStatus.PROCESSING,
      attempts: 1,
      lockedAt: new Date(now.getTime() - options.leaseMs - 1),
      lockedBy: "crashed-worker",
    });
    const domainOnly = await createOutboxFixture({ withDelivery: false });

    const claimed = await firstRepository.claimBatch("replacement-worker", now, options);
    expect(claimed.map((event) => event.id)).toContain(stale.event.id);
    expect(claimed.find((event) => event.id === stale.event.id)).toMatchObject({
      attempts: 2,
      lockedBy: "replacement-worker",
    });
    expect(
      await firstClient.outboxEvent.findUniqueOrThrow({ where: { id: domainOnly.event.id } }),
    ).toMatchObject({ status: OutboxStatus.PENDING, attempts: 0 });
  });

  it("leaves a delivery for an unconfigured channel pending", async () => {
    const { event } = await createOutboxFixture({
      deliveryChannel: NotificationChannel.SMS,
    });
    const claimed = await firstRepository.claimBatch(
      "email-worker",
      new Date("2026-09-26T04:30:00.000Z"),
      options,
    );

    expect(claimed).toHaveLength(0);
    expect(
      await firstClient.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).toMatchObject({ status: OutboxStatus.PENDING, attempts: 0 });
  });

  it("skips an already sent delivery and only completes its outbox event", async () => {
    const { event } = await createOutboxFixture({ deliveryStatus: NotificationStatus.SENT });
    const provider = new ScriptedProvider();
    const now = new Date("2026-09-26T05:00:00.000Z");
    const processor = new OutboxProcessor(
      firstRepository,
      new NotificationOutboxHandler(firstRepository, staticResolver, provider),
      new CapturingLogger(),
      "worker-idempotent",
      options,
      () => now,
    );

    expect(await processor.runOnce()).toMatchObject({ completed: 1 });
    expect(provider.messages).toHaveLength(0);
    expect(
      await firstClient.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).toMatchObject({ status: OutboxStatus.COMPLETED, completedAt: now });
  });
});
