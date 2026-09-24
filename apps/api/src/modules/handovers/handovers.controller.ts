/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Headers, Param, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { CompleteHandoverDto } from "./handover.dto.js";
import { HandoversService } from "./handovers.service.js";

@Controller("repair-orders/:repairOrderId/handovers")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.HANDOVER_COMPLETE)
export class HandoversController {
  constructor(private readonly service: HandoversService) {}

  @Post()
  complete(
    @CurrentTenant() tenant: TenantContext,
    @Param("repairOrderId") repairOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CompleteHandoverDto,
  ) {
    return this.service.complete(tenant, repairOrderId, dto, idempotencyKey);
  }
}
