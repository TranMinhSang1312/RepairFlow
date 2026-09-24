/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { PresignIntakeMediaDto, PresignOrderMediaDto } from "./media.dto.js";
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

@Controller("repair-orders/:repairOrderId/media")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
export class OrderMediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post("presign")
  @RequireCapabilities(Capability.REPAIR_ORDER_READ_ASSIGNED)
  presign(
    @CurrentTenant() tenant: TenantContext,
    @Param("repairOrderId") repairOrderId: string,
    @Body() dto: PresignOrderMediaDto,
  ) {
    return this.mediaService.presignOrder(tenant, repairOrderId, dto);
  }
}
