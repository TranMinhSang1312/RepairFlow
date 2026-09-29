/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../../../common/auth/access-token.guard.js";
import { Capability } from "../../../../common/permissions/capability.js";
import { PermissionGuard } from "../../../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../../../common/tenant/tenant.guard.js";
import { CreateCustomerSummaryDto } from "./customer-summary.dto.js";
import { CustomerSummaryService } from "./customer-summary.service.js";

@Controller("ai/customer-summaries")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.AI_ASSISTANCE_USE)
export class CustomerSummaryController {
  constructor(private readonly service: CustomerSummaryService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreateCustomerSummaryDto,
  ) {
    return this.service.create(tenant, dto, idempotencyKey);
  }
}
