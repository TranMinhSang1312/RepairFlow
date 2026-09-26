import { OutboxStatus, Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import type {
  ClaimedNotificationDelivery,
  ClaimedOutboxEvent,
  OutboxWorkerOptions,
} from "./outbox.types.js";

interface ClaimedOutboxRow {
  id: string;
  shopId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  attempts: number;
  lockedAt: Date;
  lockedBy: string;
}

export type FailedClaimResult = "RETRY" | "DEAD_LETTER";

export function retryDelayMs(attempt: number, baseMs: number, maximumMs: number): number {
  const exponent = Math.max(0, Math.min(30, attempt - 1));
  return Math.min(maximumMs, baseMs * 2 ** exponent);
}

export class OutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claimBatch(
    workerId: string,
    now: Date,
    options: OutboxWorkerOptions,
  ): Promise<ClaimedOutboxEvent[]> {
    if (options.eventTypes.length === 0 || options.notificationChannels.length === 0) return [];
    const leaseExpiredAt = new Date(now.getTime() - options.leaseMs);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        UPDATE "outbox_events" AS event
        SET
          "status" = 'DEAD_LETTER'::"OutboxStatus",
          "lockedAt" = NULL,
          "lockedBy" = NULL,
          "lastError" = 'LEASE_EXPIRED'
        WHERE event."status" = 'PROCESSING'::"OutboxStatus"
          AND event."eventType" IN (${Prisma.join(options.eventTypes)})
          AND event."lockedAt" <= ${leaseExpiredAt}
          AND event."attempts" >= ${options.maxAttempts}
          AND EXISTS (
            SELECT 1
            FROM "notification_deliveries" AS delivery
            WHERE delivery."outboxEventId" = event."id"
              AND delivery."channel"::text IN (${Prisma.join(options.notificationChannels)})
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "notification_deliveries" AS unsupported
            WHERE unsupported."outboxEventId" = event."id"
              AND unsupported."status" <> 'SENT'::"NotificationStatus"
              AND unsupported."channel"::text NOT IN (${Prisma.join(options.notificationChannels)})
          )
      `;

      const rows = await transaction.$queryRaw<ClaimedOutboxRow[]>`
        WITH candidates AS (
          SELECT event."id"
          FROM "outbox_events" AS event
          WHERE event."attempts" < ${options.maxAttempts}
            AND event."eventType" IN (${Prisma.join(options.eventTypes)})
            AND EXISTS (
              SELECT 1
              FROM "notification_deliveries" AS delivery
              WHERE delivery."outboxEventId" = event."id"
                AND delivery."channel"::text IN (${Prisma.join(options.notificationChannels)})
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "notification_deliveries" AS unsupported
              WHERE unsupported."outboxEventId" = event."id"
                AND unsupported."status" <> 'SENT'::"NotificationStatus"
                AND unsupported."channel"::text NOT IN (${Prisma.join(options.notificationChannels)})
            )
            AND (
              (
                event."status" IN (
                  'PENDING'::"OutboxStatus",
                  'FAILED'::"OutboxStatus"
                )
                AND event."availableAt" <= ${now}
              )
              OR (
                event."status" = 'PROCESSING'::"OutboxStatus"
                AND event."lockedAt" <= ${leaseExpiredAt}
              )
            )
          ORDER BY event."availableAt" ASC, event."id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${options.batchSize}
        )
        UPDATE "outbox_events" AS event
        SET
          "status" = 'PROCESSING'::"OutboxStatus",
          "attempts" = event."attempts" + 1,
          "lockedAt" = ${now},
          "lockedBy" = ${workerId},
          "lastError" = CASE
            WHEN event."status" = 'PROCESSING'::"OutboxStatus" THEN 'LEASE_EXPIRED'
            ELSE event."lastError"
          END
        FROM candidates
        WHERE event."id" = candidates."id"
        RETURNING
          event."id",
          event."shopId",
          event."eventType",
          event."aggregateType",
          event."aggregateId",
          event."payload",
          event."attempts",
          event."lockedAt",
          event."lockedBy"
      `;

      if (rows.length === 0) return [];
      const deliveries = await transaction.notificationDelivery.findMany({
        where: { outboxEventId: { in: rows.map((row) => row.id) } },
        orderBy: [{ outboxEventId: "asc" }, { channel: "asc" }],
        select: {
          id: true,
          outboxEventId: true,
          channel: true,
          destinationHash: true,
          status: true,
          attempts: true,
        },
      });
      const deliveriesByEvent = new Map<string, ClaimedNotificationDelivery[]>();
      for (const delivery of deliveries) {
        const current = deliveriesByEvent.get(delivery.outboxEventId) ?? [];
        current.push({
          id: delivery.id,
          channel: delivery.channel,
          destinationHash: delivery.destinationHash,
          status: delivery.status,
          attempts: delivery.attempts,
        });
        deliveriesByEvent.set(delivery.outboxEventId, current);
      }
      return rows.map((row) => ({
        ...row,
        notifications: deliveriesByEvent.get(row.id) ?? [],
      }));
    });
  }

  async markDeliverySent(
    eventId: string,
    deliveryId: string,
    providerMessageId: string,
    sentAt: Date,
  ): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: {
        id: deliveryId,
        outboxEventId: eventId,
        status: { not: "SENT" },
      },
      data: {
        status: "SENT",
        providerMessageId,
        attempts: { increment: 1 },
        lastErrorCode: null,
        sentAt,
      },
    });
  }

  async markDeliveryFailed(eventId: string, deliveryId: string, code: string): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: {
        id: deliveryId,
        outboxEventId: eventId,
        status: { not: "SENT" },
      },
      data: {
        status: "FAILED",
        attempts: { increment: 1 },
        lastErrorCode: code,
      },
    });
  }

  async completeClaim(eventId: string, workerId: string, completedAt: Date): Promise<void> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: { id: eventId, status: OutboxStatus.PROCESSING, lockedBy: workerId },
      data: {
        status: OutboxStatus.COMPLETED,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        completedAt,
      },
    });
    if (result.count !== 1) throw new Error("OUTBOX_CLAIM_LOST");
  }

  async failClaim(
    event: Pick<ClaimedOutboxEvent, "id" | "attempts">,
    workerId: string,
    code: string,
    failedAt: Date,
    options: OutboxWorkerOptions,
    forceDeadLetter = false,
  ): Promise<FailedClaimResult> {
    const deadLetter = forceDeadLetter || event.attempts >= options.maxAttempts;
    const availableAt = deadLetter
      ? failedAt
      : new Date(
          failedAt.getTime() +
            retryDelayMs(event.attempts, options.retryBaseMs, options.retryMaxMs),
        );
    const result = await this.prisma.outboxEvent.updateMany({
      where: { id: event.id, status: OutboxStatus.PROCESSING, lockedBy: workerId },
      data: {
        status: deadLetter ? OutboxStatus.DEAD_LETTER : OutboxStatus.FAILED,
        availableAt,
        lockedAt: null,
        lockedBy: null,
        lastError: code,
      },
    });
    if (result.count !== 1) throw new Error("OUTBOX_CLAIM_LOST");
    return deadLetter ? "DEAD_LETTER" : "RETRY";
  }
}
