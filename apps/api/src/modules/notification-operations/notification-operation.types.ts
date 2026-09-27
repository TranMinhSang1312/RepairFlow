import type { Prisma } from "@prisma/client";

export const notificationOperationSelect = {
  id: true,
  eventType: true,
  aggregateType: true,
  aggregateId: true,
  status: true,
  attempts: true,
  lockVersion: true,
  availableAt: true,
  lastError: true,
  completedAt: true,
  createdAt: true,
  notifications: {
    orderBy: [{ channel: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      channel: true,
      status: true,
      attempts: true,
      lastErrorCode: true,
      sentAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.OutboxEventSelect;

export type NotificationOperationRecord = Prisma.OutboxEventGetPayload<{
  select: typeof notificationOperationSelect;
}>;

export interface NotificationDeliveryOperationView {
  id: string;
  channel: string;
  status: string;
  attempts: number;
  lastErrorCode: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationOperationView {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: string;
  attempts: number;
  lockVersion: number;
  availableAt: string;
  lastErrorCode: string | null;
  completedAt: string | null;
  createdAt: string;
  deliveries: NotificationDeliveryOperationView[];
}

export interface NotificationOperationResponse {
  data: NotificationOperationView;
}

export interface NotificationOperationPageResponse {
  data: NotificationOperationView[];
  meta: { nextCursor: string | null };
}

export function toNotificationOperationView(
  record: NotificationOperationRecord,
): NotificationOperationView {
  return {
    id: record.id,
    eventType: safeLabel(record.eventType),
    aggregateType: safeLabel(record.aggregateType),
    aggregateId: record.aggregateId,
    status: record.status,
    attempts: record.attempts,
    lockVersion: record.lockVersion,
    availableAt: record.availableAt.toISOString(),
    lastErrorCode: safeErrorCode(record.lastError),
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    deliveries: record.notifications.map((delivery) => ({
      id: delivery.id,
      channel: delivery.channel,
      status: delivery.status,
      attempts: delivery.attempts,
      lastErrorCode: safeErrorCode(delivery.lastErrorCode),
      sentAt: delivery.sentAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
    })),
  };
}

function safeLabel(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,99}$/u.test(value) ? value : "UNKNOWN";
}

function safeErrorCode(value: string | null): string | null {
  if (value === null) return null;
  return /^[A-Z][A-Z0-9_]{0,99}$/u.test(value) ? value : "UNKNOWN_ERROR";
}
