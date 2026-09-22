import { Injectable } from "@nestjs/common";

import type { NotificationMessage, NotificationProvider } from "./notification-provider.js";

/** Test/development provider boundary. The RF-036 request path intentionally never calls it. */
@Injectable()
export class DeterministicFakeNotificationProvider implements NotificationProvider {
  async deliver(message: NotificationMessage): Promise<{ providerMessageId: string }> {
    return Promise.resolve({ providerMessageId: `fake:${message.outboxEventId}` });
  }
}
