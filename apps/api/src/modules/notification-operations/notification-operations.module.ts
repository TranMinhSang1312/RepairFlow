import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { NotificationOperationsController } from "./notification-operations.controller.js";
import { NotificationOperationsRepository } from "./notification-operations.repository.js";
import { NotificationOperationsService } from "./notification-operations.service.js";

@Module({
  imports: [IdempotencyModule],
  controllers: [NotificationOperationsController],
  providers: [NotificationOperationsRepository, NotificationOperationsService],
})
export class NotificationOperationsModule {}
