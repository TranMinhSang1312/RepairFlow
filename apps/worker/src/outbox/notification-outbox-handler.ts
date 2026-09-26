import { NotificationStatus } from "@prisma/client";

import type { NotificationMessageResolver } from "./notification-message-resolver.js";
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
    private readonly resolver: NotificationMessageResolver,
    private readonly provider: NotificationProvider,
  ) {}

  async handle(event: ClaimedOutboxEvent, now: Date): Promise<void> {
    for (const delivery of event.notifications) {
      if (delivery.status === NotificationStatus.SENT) continue;
      try {
        const message = await this.resolver.resolve(event, delivery, now);
        const result = await this.provider.deliver(message);
        await this.repository.markDeliverySent(
          event.id,
          delivery.id,
          result.providerMessageId,
          now,
        );
      } catch (error) {
        const code = safeOutboxErrorCode(error);
        await this.repository.markDeliveryFailed(event.id, delivery.id, code);
        throw error instanceof OutboxDeliveryError ? error : new OutboxDeliveryError(code);
      }
    }
  }
}
