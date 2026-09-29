/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../../../common/auth/access-token.guard.js";
import { Capability } from "../../../../common/permissions/capability.js";
import { PermissionGuard } from "../../../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../../../common/tenant/tenant.guard.js";
import { CreateDeviceOcrDto } from "./device-ocr.dto.js";
import { DeviceOcrService } from "./device-ocr.service.js";

@Controller("ai/device-ocr")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.AI_ASSISTANCE_USE)
export class DeviceOcrController {
  constructor(private readonly service: DeviceOcrService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreateDeviceOcrDto,
  ) {
    return this.service.create(tenant, dto, idempotencyKey);
  }
}
