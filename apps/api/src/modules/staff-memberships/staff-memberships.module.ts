import { Module } from "@nestjs/common";

import { RateLimiterModule } from "../../common/auth/rate-limiter.module.js";
import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { StaffInvitationTokenService } from "./staff-invitation-token.service.js";
import { StaffMembershipsController } from "./staff-memberships.controller.js";
import { StaffMembershipsService } from "./staff-memberships.service.js";

@Module({
  imports: [IdentityModule, IdempotencyModule, RateLimiterModule],
  controllers: [StaffMembershipsController],
  providers: [StaffMembershipsService, StaffInvitationTokenService],
})
export class StaffMembershipsModule {}
