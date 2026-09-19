/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { CreateDeviceDto } from "./device.dto.js";
import { DevicesService } from "./devices.service.js";

@Controller("customers/:customerId/devices")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @RequireCapabilities(Capability.DEVICE_LIST)
  list(@CurrentTenant() tenant: TenantContext, @Param("customerId") customerId: string) {
    return this.devicesService.list(tenant, customerId);
  }

  @Post()
  @RequireCapabilities(Capability.DEVICE_WRITE)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Param("customerId") customerId: string,
    @Body() dto: CreateDeviceDto,
  ) {
    return this.devicesService.create(tenant, customerId, dto);
  }
}
