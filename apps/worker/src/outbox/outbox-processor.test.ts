import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { OutboxHandler } from "./notification-outbox-handler.js";
import { OutboxDeliveryError } from "./outbox-errors.js";
import { OutboxProcessor } from "./outbox-processor.js";
import type { ClaimedOutboxEvent, OutboxWorkerOptions, WorkerLogger } from "./outbox.types.js";

const options: OutboxWorkerOptions = {
  eventTypes: ["TEST_EVENT"],
  notificationChannels: [NotificationChannel.EMAIL],
  batchSize: 2,
  leaseMs: 30000,
  maxAttempts: 3,
  retryBaseMs: 1000,
  retryMaxMs: 10000,
};

const logger: WorkerLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function claimedEvent(id: string): ClaimedOutboxEvent {
  return {
    id,
    shopId: "00000000-0000-4000-8000-000000000001",
    eventType: "TEST_EVENT",
    aggregateType: "TEST",
    aggregateId: id,
    payload: {},
    attempts: 1,
    lockedAt: new Date("2026-09-26T00:00:00.000Z"),
    lockedBy: "worker",
    notifications: [
      {
        id: `${id}-delivery`,
        channel: NotificationChannel.EMAIL,
        destinationHash: "0".repeat(64),
        status: NotificationStatus.PENDING,
        attempts: 0,
      },
    ],
  };
}

describe("OutboxProcessor", () => {
  it("starts every claimed event without making later leases wait for earlier delivery", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstDelivery = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: string[] = [];
    const handler: OutboxHandler = {
      handle: vi.fn(async (event) => {
        started.push(event.id);
        if (event.id === "event-a") await firstDelivery;
      }),
    };
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([claimedEvent("event-a"), claimedEvent("event-b")]),
      completeClaim: vi.fn().mockResolvedValue(undefined),
      failClaim: vi.fn().mockResolvedValue("RETRY" as const),
    };
    const processor = new OutboxProcessor(
      repository,
      handler,
      logger,
      "worker",
      options,
      () => new Date("2026-09-26T00:00:00.000Z"),
    );

    const run = processor.runOnce();
    await Promise.resolve();
    expect(started).toEqual(["event-a", "event-b"]);
    releaseFirst?.();

    await expect(run).resolves.toEqual({
      claimed: 2,
      completed: 2,
      retried: 0,
      deadLettered: 0,
    });
  });

  it("dead-letters a permanent integrity failure on its first attempt", async () => {
    const claimed = claimedEvent("event-invalid");
    const handler: OutboxHandler = {
      handle: vi.fn().mockRejectedValue(new OutboxDeliveryError("PUBLIC_LINK_INVALID", false)),
    };
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([claimed]),
      completeClaim: vi.fn().mockResolvedValue(undefined),
      failClaim: vi.fn().mockResolvedValue("DEAD_LETTER" as const),
    };
    const processor = new OutboxProcessor(
      repository,
      handler,
      logger,
      "worker",
      options,
      () => new Date("2026-09-26T00:00:00.000Z"),
    );

    await expect(processor.runOnce()).resolves.toMatchObject({ deadLettered: 1, retried: 0 });
    expect(repository.failClaim).toHaveBeenCalledWith(
      claimed,
      "worker",
      "PUBLIC_LINK_INVALID",
      new Date("2026-09-26T00:00:00.000Z"),
      options,
      true,
    );
  });
});
