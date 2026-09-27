import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../../common/idempotency/idempotency.module.js";
import { NotificationsModule } from "../../notifications/notifications.module.js";
import { RepairOrderStateMachineRepository } from "./repair-order-state-machine.repository.js";
import { RepairOrderStateMachineService } from "./repair-order-state-machine.service.js";

@Module({
  imports: [IdempotencyModule, NotificationsModule],
  providers: [RepairOrderStateMachineRepository, RepairOrderStateMachineService],
  exports: [RepairOrderStateMachineService],
})
export class RepairOrderStateMachineModule {}
