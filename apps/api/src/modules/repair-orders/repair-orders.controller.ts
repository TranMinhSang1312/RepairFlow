/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { CreateRepairOrderDto, ListRepairOrdersQueryDto } from "./repair-order.dto.js";
import { RepairOrdersService } from "./repair-orders.service.js";

@Controller("repair-orders")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
export class RepairOrdersController {
  constructor(private readonly repairOrdersService: RepairOrdersService) {}

  @Get()
  @RequireCapabilities(Capability.REPAIR_ORDER_READ_ASSIGNED)
  list(@CurrentTenant() tenant: TenantContext, @Query() query: ListRepairOrdersQueryDto) {
    return this.repairOrdersService.list(tenant, query);
  }

  @Get(":repairOrderId")
  @RequireCapabilities(Capability.REPAIR_ORDER_READ_ASSIGNED)
  detail(@CurrentTenant() tenant: TenantContext, @Param("repairOrderId") repairOrderId: string) {
    return this.repairOrdersService.detail(tenant, repairOrderId);
  }

  @Post()
  @RequireCapabilities(Capability.INTAKE_CREATE)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreateRepairOrderDto,
  ) {
    return this.repairOrdersService.create(tenant, dto, idempotencyKey);
  }
}
