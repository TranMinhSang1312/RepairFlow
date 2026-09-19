import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { MediaModule } from "../media/media.module.js";
import { RepairOrdersController } from "./repair-orders.controller.js";
import { RepairOrdersRepository } from "./repair-orders.repository.js";
import { RepairOrdersService } from "./repair-orders.service.js";

@Module({
  imports: [IdempotencyModule, MediaModule],
  controllers: [RepairOrdersController],
  providers: [RepairOrdersRepository, RepairOrdersService],
})
export class RepairOrdersModule {}
