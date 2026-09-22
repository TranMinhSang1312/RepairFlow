export interface NotificationMessage {
  outboxEventId: string;
}

export interface NotificationProvider {
  deliver(message: NotificationMessage): Promise<{ providerMessageId: string }>;
}

export const NOTIFICATION_PROVIDER = Symbol("NOTIFICATION_PROVIDER");
