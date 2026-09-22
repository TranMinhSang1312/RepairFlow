import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { PublicAccessModule } from "../public-access/public-access.module.js";
import { RepairOrderStateMachineModule } from "../repair-orders/state-machine/repair-order-state-machine.module.js";
import { QuotesController } from "./quotes.controller.js";
import { QuotesRepository } from "./quotes.repository.js";
import { QuotesService } from "./quotes.service.js";

@Module({
  imports: [
    IdempotencyModule,
    NotificationsModule,
    PublicAccessModule,
    RepairOrderStateMachineModule,
  ],
  controllers: [QuotesController],
  providers: [QuotesRepository, QuotesService],
})
export class QuotesModule {}
