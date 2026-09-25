/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Headers, Param, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { CreateWarrantyFollowUpDto } from "./warranty-follow-up.dto.js";
import { WarrantiesService } from "./warranties.service.js";

@Controller("repair-orders/:sourceOrderId/warranty-orders")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.WARRANTY_FOLLOW_UP_CREATE)
export class WarrantiesController {
  constructor(private readonly service: WarrantiesService) {}

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Param("sourceOrderId") sourceOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreateWarrantyFollowUpDto,
  ) {
    return this.service.createFollowUp(tenant, sourceOrderId, dto, idempotencyKey);
  }
}
