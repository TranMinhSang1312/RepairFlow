import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { MediaModule } from "../media/media.module.js";
import { DiagnosesController } from "../diagnoses/diagnoses.controller.js";
import { DiagnosesRepository } from "../diagnoses/diagnoses.repository.js";
import { DiagnosesService } from "../diagnoses/diagnoses.service.js";
import { QuotesModule } from "../quotes/quotes.module.js";
import { ServiceExecutionModule } from "../service-execution/service-execution.module.js";
import { AssignmentsController } from "./assignments/assignments.controller.js";
import { AssignmentsRepository } from "./assignments/assignments.repository.js";
import { AssignmentsService } from "./assignments/assignments.service.js";
import { RepairOrdersController } from "./repair-orders.controller.js";
import { RepairOrderIntakeService } from "./repair-order-intake.service.js";
import { RepairOrdersRepository } from "./repair-orders.repository.js";
import { RepairOrdersService } from "./repair-orders.service.js";
import { RepairOrderStateMachineModule } from "./state-machine/repair-order-state-machine.module.js";

@Module({
  imports: [
    IdempotencyModule,
    MediaModule,
    RepairOrderStateMachineModule,
    QuotesModule,
    ServiceExecutionModule,
  ],
  controllers: [RepairOrdersController, AssignmentsController, DiagnosesController],
  providers: [
    RepairOrdersRepository,
    RepairOrdersService,
    RepairOrderIntakeService,
    AssignmentsRepository,
    AssignmentsService,
    DiagnosesRepository,
    DiagnosesService,
  ],
  exports: [RepairOrderStateMachineModule, RepairOrderIntakeService],
})
export class RepairOrdersModule {}
