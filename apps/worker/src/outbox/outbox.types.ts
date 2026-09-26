import type { NotificationChannel, NotificationStatus, Prisma } from "@prisma/client";

export interface ClaimedNotificationDelivery {
  id: string;
  channel: NotificationChannel;
  destinationHash: string;
  status: NotificationStatus;
  attempts: number;
}

export interface ClaimedOutboxEvent {
  id: string;
  shopId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  attempts: number;
  lockedAt: Date;
  lockedBy: string;
  notifications: ClaimedNotificationDelivery[];
}

export interface OutboxWorkerOptions {
  eventTypes: readonly string[];
  notificationChannels: readonly NotificationChannel[];
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

export interface OutboxRunSummary {
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
}

export interface WorkerLogger {
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}
