/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { OutboxStatus } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import type {
  ListNotificationOperationsQueryDto,
  RetryNotificationOperationDto,
} from "./notification-operation.dto.js";
import {
  toNotificationOperationView,
  type NotificationOperationPageResponse,
  type NotificationOperationResponse,
} from "./notification-operation.types.js";
import {
  NotificationOperationsRepository,
  type NotificationOperationCursor,
} from "./notification-operations.repository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class NotificationOperationsService {
  constructor(
    private readonly repository: NotificationOperationsRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(
    tenant: TenantContext,
    query: ListNotificationOperationsQueryDto,
  ): Promise<NotificationOperationPageResponse> {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const page = await this.repository.list({
      shopId: tenant.shopId,
      statuses: query.status ? [query.status] : [OutboxStatus.FAILED, OutboxStatus.DEAD_LETTER],
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      cursor,
      limit: query.limit,
    });
    const last = page.records.at(-1);
    return {
      data: page.records.map(toNotificationOperationView),
      meta: {
        nextCursor:
          page.hasMore && last
            ? this.encodeCursor({ id: last.id, createdAt: last.createdAt })
            : null,
      },
    };
  }

  async detail(tenant: TenantContext, eventId: string): Promise<NotificationOperationResponse> {
    const id = this.validatedId(eventId);
    const record = await this.repository.findFailed(tenant.shopId, id);
    if (!record) throw this.notFound();
    return { data: toNotificationOperationView(record) };
  }

  retry(
    tenant: TenantContext,
    eventId: string,
    dto: RetryNotificationOperationDto,
    key: string | undefined,
  ): Promise<NotificationOperationResponse> {
    const id = this.validatedId(eventId);
    return this.idempotency.execute({
      tenant,
      scope: `notification-operations.retry:${id}`,
      key,
      request: { eventId: id, expectedLockVersion: dto.expectedLockVersion },
      responseStatus: HttpStatus.OK,
      operation: async (transaction) => {
        const current = await this.repository.findForRetry(transaction, tenant.shopId, id);
        if (!current) throw this.notFound();
        if (current.lockVersion !== dto.expectedLockVersion) throw this.concurrent();
        if (current.status !== OutboxStatus.FAILED && current.status !== OutboxStatus.DEAD_LETTER) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "NOTIFICATION_RETRY_NOT_ALLOWED",
            "Only failed or dead-letter notification jobs can be retried.",
          );
        }
        const now = new Date();
        const updated = await this.repository.retryEvent(transaction, {
          shopId: tenant.shopId,
          id,
          status: current.status,
          expectedLockVersion: dto.expectedLockVersion,
          now,
        });
        if (updated.count !== 1) throw this.concurrent();
        await this.repository.resetFailedDeliveries(transaction, tenant.shopId, id);
        await this.repository.appendRetryAudit(transaction, {
          shopId: tenant.shopId,
          actorUserId: tenant.userId,
          eventId: id,
          requestId: tenant.requestId,
          beforeData: this.auditSnapshot(current),
          afterData: {
            status: OutboxStatus.PENDING,
            attempts: 0,
            lockVersion: current.lockVersion + 1,
          },
          createdAt: now,
        });
        const retried = await this.repository.findAfterRetry(transaction, tenant.shopId, id);
        if (!retried) throw this.notFound();
        return { data: toNotificationOperationView(retried) };
      },
    });
  }

  private auditSnapshot(record: Parameters<typeof toNotificationOperationView>[0]) {
    const view = toNotificationOperationView(record);
    return {
      status: view.status,
      attempts: view.attempts,
      lockVersion: view.lockVersion,
      lastErrorCode: view.lastErrorCode,
      deliveries: view.deliveries.map((delivery) => ({
        id: delivery.id,
        channel: delivery.channel,
        status: delivery.status,
        attempts: delivery.attempts,
        lastErrorCode: delivery.lastErrorCode,
      })),
    };
  }

  private encodeCursor(cursor: NotificationOperationCursor): string {
    return Buffer.from(
      JSON.stringify({ id: cursor.id, createdAt: cursor.createdAt.toISOString() }),
    ).toString("base64url");
  }

  private decodeCursor(value: string): NotificationOperationCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
        id?: unknown;
        createdAt?: unknown;
      };
      const createdAt = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : null;
      if (
        typeof parsed.id !== "string" ||
        !UUID_PATTERN.test(parsed.id) ||
        !createdAt ||
        Number.isNaN(createdAt.getTime())
      ) {
        throw new Error("Invalid cursor");
      }
      return { id: parsed.id.toLowerCase(), createdAt };
    } catch {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [{ field: "cursor", code: "INVALID_CURSOR", message: "cursor is invalid" }],
      );
    }
  }

  private validatedId(value: string): string {
    if (!UUID_PATTERN.test(value)) throw this.notFound();
    return value.toLowerCase();
  }

  private concurrent(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      "CONCURRENT_UPDATE",
      "The notification job changed concurrently. Reload and try again.",
    );
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
