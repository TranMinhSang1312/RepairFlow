/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { UpdateAiCapabilitySettingDto } from "./ai.dto.js";
import { AiSettingsService } from "./ai-settings.service.js";

@Controller("settings/ai")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.AI_SETTINGS_MANAGE)
export class AiSettingsController {
  constructor(private readonly service: AiSettingsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.service.list(tenant);
  }

  @Patch(":capability")
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param("capability") capability: string,
    @Body() dto: UpdateAiCapabilitySettingDto,
  ) {
    return this.service.update(tenant, capability, dto);
  }
}
