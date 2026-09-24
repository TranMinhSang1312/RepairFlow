import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { MediaModule } from "../media/media.module.js";
import { RepairOrderStateMachineModule } from "../repair-orders/state-machine/repair-order-state-machine.module.js";
import { QcRunsController } from "./runs/qc-runs.controller.js";
import { QcRunsRepository } from "./runs/qc-runs.repository.js";
import { QcRunsService } from "./runs/qc-runs.service.js";
import { QcTemplatesController } from "./templates/qc-templates.controller.js";
import { QcTemplatesRepository } from "./templates/qc-templates.repository.js";
import { QcTemplatesService } from "./templates/qc-templates.service.js";

@Module({
  imports: [IdempotencyModule, MediaModule, RepairOrderStateMachineModule],
  controllers: [QcTemplatesController, QcRunsController],
  providers: [QcTemplatesRepository, QcTemplatesService, QcRunsRepository, QcRunsService],
})
export class QualityControlModule {}
