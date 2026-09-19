/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { PresignIntakeMediaDto } from "./media.dto.js";
import { MediaService } from "./media.service.js";

@Controller("media")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post("presign")
  @RequireCapabilities(Capability.INTAKE_MEDIA_UPLOAD)
  presign(@CurrentTenant() tenant: TenantContext, @Body() dto: PresignIntakeMediaDto) {
    return this.mediaService.presignIntake(tenant, dto);
  }
}
