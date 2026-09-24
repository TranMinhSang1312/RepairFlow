/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Headers, Param, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { CreatePaymentDto } from "./payment.dto.js";
import { PaymentsService } from "./payments.service.js";

@Controller("repair-orders/:repairOrderId/payments")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.PAYMENT_CREATE)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Param("repairOrderId") repairOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.service.create(tenant, repairOrderId, dto, idempotencyKey);
  }
}
