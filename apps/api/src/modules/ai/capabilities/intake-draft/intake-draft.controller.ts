/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../../../common/auth/access-token.guard.js";
import { Capability } from "../../../../common/permissions/capability.js";
import { PermissionGuard } from "../../../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../../../common/tenant/tenant.guard.js";
import { CreateIntakeDraftDto } from "./intake-draft.dto.js";
import { IntakeDraftService } from "./intake-draft.service.js";

@Controller("ai/intake-drafts")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.AI_ASSISTANCE_USE)
export class IntakeDraftController {
  constructor(private readonly service: IntakeDraftService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreateIntakeDraftDto,
  ) {
    return this.service.create(tenant, dto, idempotencyKey);
  }
}
