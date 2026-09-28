import { OutboxStatus } from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { ClaimedOutboxEvent } from "../outbox/outbox.types.js";
import type { OutboxWorkerOptions } from "../outbox/outbox.types.js";

export const AI_RUN_REQUESTED_EVENT = "AI_RUN_REQUESTED_V1";

export interface AiOutboxWorkerOptions {
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

interface ClaimedAiOutboxRow {
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

export type AiFailedClaimResult = "RETRY" | "DEAD_LETTER";

export class AiOutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claimBatch(
    workerId: string,
    now: Date,
    options: AiOutboxWorkerOptions | OutboxWorkerOptions,
  ): Promise<ClaimedOutboxEvent[]> {
    const leaseExpiredAt = new Date(now.getTime() - options.leaseMs);
    const rows = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        UPDATE "outbox_events" AS event
        SET
          "status" = 'DEAD_LETTER'::"OutboxStatus",
          "lockedAt" = NULL,
          "lockedBy" = NULL,
          "lastError" = 'LEASE_EXPIRED',
          "lockVersion" = event."lockVersion" + 1
        WHERE event."status" = 'PROCESSING'::"OutboxStatus"
          AND event."eventType" = ${AI_RUN_REQUESTED_EVENT}
          AND event."lockedAt" <= ${leaseExpiredAt}
          AND event."attempts" >= ${options.maxAttempts}
      `;

      return transaction.$queryRaw<ClaimedAiOutboxRow[]>`
        WITH candidates AS (
          SELECT event."id"
          FROM "outbox_events" AS event
          WHERE event."attempts" < ${options.maxAttempts}
            AND event."eventType" = ${AI_RUN_REQUESTED_EVENT}
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
          "lockVersion" = event."lockVersion" + 1,
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
    });

    return rows.map((row) => ({ ...row, notifications: [] }));
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
        lockVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new Error("OUTBOX_CLAIM_LOST");
  }

  async failClaim(
    event: Pick<ClaimedOutboxEvent, "id" | "attempts">,
    workerId: string,
    code: string,
    failedAt: Date,
    options: AiOutboxWorkerOptions | OutboxWorkerOptions,
    forceDeadLetter = false,
  ): Promise<AiFailedClaimResult> {
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
        lockVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new Error("OUTBOX_CLAIM_LOST");
    return deadLetter ? "DEAD_LETTER" : "RETRY";
  }
}

export function retryDelayMs(attempt: number, baseMs: number, maximumMs: number): number {
  const exponent = Math.max(0, Math.min(30, attempt - 1));
  return Math.min(maximumMs, baseMs * 2 ** exponent);
}
