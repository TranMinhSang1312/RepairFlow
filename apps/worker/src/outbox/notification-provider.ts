export interface NotificationMessage {
  outboxEventId: string;
  notificationDeliveryId: string;
  channel: "EMAIL";
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface NotificationProvider {
  deliver(message: NotificationMessage): Promise<{ providerMessageId: string }>;
}

/** Local/test boundary. It performs no network I/O and retains no message content. */
export class DeterministicFakeNotificationProvider implements NotificationProvider {
  deliver(message: NotificationMessage): Promise<{ providerMessageId: string }> {
    return Promise.resolve({
      providerMessageId: `fake:${message.notificationDeliveryId}`,
    });
  }
}
