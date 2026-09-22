import { Module } from "@nestjs/common";

import { DeterministicFakeNotificationProvider } from "./deterministic-fake-notification.provider.js";
import { FakeNotificationAdapter } from "./fake-notification.adapter.js";
import { NOTIFICATION_PROVIDER } from "./notification-provider.js";

@Module({
  providers: [
    FakeNotificationAdapter,
    {
      provide: NOTIFICATION_PROVIDER,
      useClass: DeterministicFakeNotificationProvider,
    },
  ],
  exports: [FakeNotificationAdapter, NOTIFICATION_PROVIDER],
})
export class NotificationsModule {}
