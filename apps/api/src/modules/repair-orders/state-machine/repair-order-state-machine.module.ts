import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../../common/idempotency/idempotency.module.js";
import { RepairOrderStateMachineRepository } from "./repair-order-state-machine.repository.js";
import { RepairOrderStateMachineService } from "./repair-order-state-machine.service.js";

@Module({
  imports: [IdempotencyModule],
  providers: [RepairOrderStateMachineRepository, RepairOrderStateMachineService],
  exports: [RepairOrderStateMachineService],
})
export class RepairOrderStateMachineModule {}
