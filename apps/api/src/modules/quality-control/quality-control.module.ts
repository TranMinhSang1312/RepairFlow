import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { QcTemplatesController } from "./templates/qc-templates.controller.js";
import { QcTemplatesRepository } from "./templates/qc-templates.repository.js";
import { QcTemplatesService } from "./templates/qc-templates.service.js";

@Module({
  imports: [IdempotencyModule],
  controllers: [QcTemplatesController],
  providers: [QcTemplatesRepository, QcTemplatesService],
})
export class QualityControlModule {}
