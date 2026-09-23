import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { ServiceExecutionController } from "./service-execution.controller.js";
import { ServiceExecutionRepository } from "./service-execution.repository.js";
import { ServiceExecutionService } from "./service-execution.service.js";

@Module({
  imports: [IdempotencyModule],
  controllers: [ServiceExecutionController],
  providers: [ServiceExecutionRepository, ServiceExecutionService],
})
export class ServiceExecutionModule {}
