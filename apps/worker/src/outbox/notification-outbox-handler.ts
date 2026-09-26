import { NotificationStatus } from "@prisma/client";

import type { NotificationProvider } from "./notification-provider.js";
import { OutboxDeliveryError, safeOutboxErrorCode } from "./outbox-errors.js";
import type { OutboxRepository } from "./outbox-repository.js";
import type { ClaimedOutboxEvent } from "./outbox.types.js";

export interface OutboxHandler {
  handle(event: ClaimedOutboxEvent, now: Date): Promise<void>;
}

export class NotificationOutboxHandler implements OutboxHandler {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly provider: NotificationProvider,
  ) {}

  async handle(event: ClaimedOutboxEvent, now: Date): Promise<void> {
    for (const delivery of event.notifications) {
      if (delivery.status === NotificationStatus.SENT) continue;
      try {
        const result = await this.provider.deliver({
          outboxEventId: event.id,
          notificationDeliveryId: delivery.id,
          channel: delivery.channel,
          idempotencyKey: `outbox:${event.id}:notification:${delivery.id}`,
        });
        await this.repository.markDeliverySent(
          event.id,
          delivery.id,
          result.providerMessageId,
          now,
        );
      } catch (error) {
        const code = safeOutboxErrorCode(error);
        await this.repository.markDeliveryFailed(event.id, delivery.id, code);
        throw new OutboxDeliveryError(code);
      }
    }
  }
}
