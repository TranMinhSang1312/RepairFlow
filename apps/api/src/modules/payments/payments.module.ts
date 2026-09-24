import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsRepository } from "./payments.repository.js";
import { PaymentsService } from "./payments.service.js";

@Module({
  imports: [IdempotencyModule],
  controllers: [PaymentsController],
  providers: [PaymentsRepository, PaymentsService],
})
export class PaymentsModule {}
