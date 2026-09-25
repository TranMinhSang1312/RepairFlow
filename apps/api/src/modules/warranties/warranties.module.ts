import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { RepairOrdersModule } from "../repair-orders/repair-orders.module.js";
import { WarrantiesController } from "./warranties.controller.js";
import { WarrantiesRepository } from "./warranties.repository.js";
import { WarrantiesService } from "./warranties.service.js";

@Module({
  imports: [IdempotencyModule, RepairOrdersModule],
  controllers: [WarrantiesController],
  providers: [WarrantiesRepository, WarrantiesService],
})
export class WarrantiesModule {}
