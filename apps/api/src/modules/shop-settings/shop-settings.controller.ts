/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime validation metadata. */

import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { CreateBranchDto, UpdateBranchDto, UpdateShopSettingsDto } from "./shop-settings.dto.js";
import { ShopSettingsService } from "./shop-settings.service.js";

@Controller("settings/shop")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
export class ShopSettingsController {
  constructor(private readonly service: ShopSettingsService) {}

  @Get()
  @RequireCapabilities(Capability.SHOP_SETTINGS_READ)
  get(@CurrentTenant() tenant: TenantContext) {
    return this.service.get(tenant);
  }

  @Patch()
  @RequireCapabilities(Capability.SHOP_SETTINGS_MANAGE)
  update(@CurrentTenant() tenant: TenantContext, @Body() dto: UpdateShopSettingsDto) {
    return this.service.update(tenant, dto);
  }

  @Post("branches")
  @RequireCapabilities(Capability.SHOP_SETTINGS_MANAGE)
  createBranch(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateBranchDto) {
    return this.service.createBranch(tenant, dto);
  }

  @Patch("branches/:branchId")
  @RequireCapabilities(Capability.SHOP_SETTINGS_MANAGE)
  updateBranch(
    @CurrentTenant() tenant: TenantContext,
    @Param("branchId") branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.service.updateBranch(tenant, branchId, dto);
  }
}
