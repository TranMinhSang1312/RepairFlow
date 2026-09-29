/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

import { Controller, Get, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { AiSettingsService } from "./ai-settings.service.js";

@Controller("ai/capabilities")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.AI_ASSISTANCE_USE)
export class AiCapabilitiesController {
  constructor(private readonly settings: AiSettingsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.settings.availability(tenant);
  }
}
