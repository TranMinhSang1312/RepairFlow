import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { MediaModule } from "../media/media.module.js";
import { AssignmentsController } from "./assignments/assignments.controller.js";
import { AssignmentsRepository } from "./assignments/assignments.repository.js";
import { AssignmentsService } from "./assignments/assignments.service.js";
import { RepairOrdersController } from "./repair-orders.controller.js";
import { RepairOrdersRepository } from "./repair-orders.repository.js";
import { RepairOrdersService } from "./repair-orders.service.js";
import { RepairOrderStateMachineRepository } from "./state-machine/repair-order-state-machine.repository.js";
import { RepairOrderStateMachineService } from "./state-machine/repair-order-state-machine.service.js";

@Module({
  imports: [IdempotencyModule, MediaModule],
  controllers: [RepairOrdersController, AssignmentsController],
  providers: [
    RepairOrdersRepository,
    RepairOrdersService,
    AssignmentsRepository,
    AssignmentsService,
    RepairOrderStateMachineRepository,
    RepairOrderStateMachineService,
  ],
  exports: [RepairOrderStateMachineService],
})
export class RepairOrdersModule {}
