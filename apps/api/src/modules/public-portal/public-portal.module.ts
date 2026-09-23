import { Module } from "@nestjs/common";

import { RateLimiterModule } from "../../common/auth/rate-limiter.module.js";
import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { PublicAccessModule } from "../public-access/public-access.module.js";
import { RepairOrderStateMachineModule } from "../repair-orders/state-machine/repair-order-state-machine.module.js";
import { PublicPortalController } from "./public-portal.controller.js";
import { PublicPortalRepository } from "./public-portal.repository.js";
import { PublicPortalService } from "./public-portal.service.js";

@Module({
  imports: [
    IdempotencyModule,
    PublicAccessModule,
    RateLimiterModule,
    RepairOrderStateMachineModule,
  ],
  controllers: [PublicPortalController],
  providers: [PublicPortalRepository, PublicPortalService],
})
export class PublicPortalModule {}
