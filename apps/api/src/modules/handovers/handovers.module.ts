import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { MediaModule } from "../media/media.module.js";
import { PublicAccessModule } from "../public-access/public-access.module.js";
import { RepairOrderStateMachineModule } from "../repair-orders/state-machine/repair-order-state-machine.module.js";
import { HandoversController } from "./handovers.controller.js";
import { HandoversRepository } from "./handovers.repository.js";
import { HandoversService } from "./handovers.service.js";

@Module({
  imports: [IdempotencyModule, MediaModule, PublicAccessModule, RepairOrderStateMachineModule],
  controllers: [HandoversController],
  providers: [HandoversRepository, HandoversService],
})
export class HandoversModule {}
