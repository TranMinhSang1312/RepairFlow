import type { NotificationChannel } from "@prisma/client";

export interface NotificationMessage {
  outboxEventId: string;
  notificationDeliveryId: string;
  channel: NotificationChannel;
  idempotencyKey: string;
}

export interface NotificationProvider {
  deliver(message: NotificationMessage): Promise<{ providerMessageId: string }>;
}

/** Local/test boundary. RF-051 replaces this with a real email adapter. */
export class DeterministicFakeNotificationProvider implements NotificationProvider {
  deliver(message: NotificationMessage): Promise<{ providerMessageId: string }> {
    return Promise.resolve({
      providerMessageId: `fake:${message.notificationDeliveryId}`,
    });
  }
}
