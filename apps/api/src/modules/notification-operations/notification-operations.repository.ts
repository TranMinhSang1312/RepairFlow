/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { NotificationChannel, NotificationStatus, OutboxStatus, Prisma } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";
import {
  notificationOperationSelect,
  type NotificationOperationRecord,
} from "./notification-operation.types.js";

export interface NotificationOperationCursor {
  id: string;
  createdAt: Date;
}

@Injectable()
export class NotificationOperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: {
    shopId: string;
    statuses: OutboxStatus[];
    eventType?: string;
    channel?: NotificationChannel;
    cursor: NotificationOperationCursor | null;
    limit: number;
  }): Promise<{ records: NotificationOperationRecord[]; hasMore: boolean }> {
    const cursorCondition: Prisma.OutboxEventWhereInput | undefined = input.cursor
      ? {
          OR: [
            { createdAt: { lt: input.cursor.createdAt } },
            { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
          ],
        }
      : undefined;
    const records = await this.prisma.outboxEvent.findMany({
      where: {
        shopId: input.shopId,
        status: { in: input.statuses },
        ...(input.eventType ? { eventType: input.eventType } : {}),
        ...(input.channel
          ? { notifications: { some: { channel: input.channel } } }
          : { notifications: { some: {} } }),
        ...(cursorCondition ? { AND: [cursorCondition] } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: notificationOperationSelect,
    });
    return { records: records.slice(0, input.limit), hasMore: records.length > input.limit };
  }

  findFailed(shopId: string, id: string): Promise<NotificationOperationRecord | null> {
    return this.prisma.outboxEvent.findFirst({
      where: { shopId, id, status: { in: [OutboxStatus.FAILED, OutboxStatus.DEAD_LETTER] } },
      select: notificationOperationSelect,
    });
  }

  findForRetry(transaction: Prisma.TransactionClient, shopId: string, id: string) {
    return transaction.outboxEvent.findFirst({
      where: { shopId, id, notifications: { some: {} } },
      select: notificationOperationSelect,
    });
  }

  retryEvent(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      id: string;
      status: OutboxStatus;
      expectedLockVersion: number;
      now: Date;
    },
  ) {
    return transaction.outboxEvent.updateMany({
      where: {
        shopId: input.shopId,
        id: input.id,
        status: input.status,
        lockVersion: input.expectedLockVersion,
        lockedAt: null,
      },
      data: {
        status: OutboxStatus.PENDING,
        attempts: 0,
        availableAt: input.now,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        completedAt: null,
        lockVersion: { increment: 1 },
      },
    });
  }

  resetFailedDeliveries(transaction: Prisma.TransactionClient, shopId: string, eventId: string) {
    return transaction.notificationDelivery.updateMany({
      where: {
        outboxEventId: eventId,
        outboxEvent: { shopId },
        status: NotificationStatus.FAILED,
      },
      data: { status: NotificationStatus.PENDING, lastErrorCode: null },
    });
  }

  findAfterRetry(
    transaction: Prisma.TransactionClient,
    shopId: string,
    id: string,
  ): Promise<NotificationOperationRecord | null> {
    return transaction.outboxEvent.findFirst({
      where: { shopId, id, notifications: { some: {} } },
      select: notificationOperationSelect,
    });
  }

  appendRetryAudit(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      actorUserId: string;
      eventId: string;
      requestId: string;
      beforeData: Prisma.InputJsonObject;
      afterData: Prisma.InputJsonObject;
      createdAt: Date;
    },
  ) {
    return transaction.auditLog.create({
      data: {
        shopId: input.shopId,
        actorUserId: input.actorUserId,
        action: "NOTIFICATION_RETRY_REQUESTED",
        entityType: "OUTBOX_EVENT",
        entityId: input.eventId,
        beforeData: input.beforeData,
        afterData: input.afterData,
        requestId: input.requestId,
        createdAt: input.createdAt,
      },
    });
  }
}
