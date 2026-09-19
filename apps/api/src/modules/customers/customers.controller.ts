/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Get, Headers, Post, Query, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { CreateCustomerDto, ListCustomersQueryDto } from "./customer.dto.js";
import { CustomersService } from "./customers.service.js";

@Controller("customers")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequireCapabilities(Capability.CUSTOMER_LIST)
  list(@CurrentTenant() tenant: TenantContext, @Query() query: ListCustomersQueryDto) {
    return this.customersService.list(tenant, query);
  }

  @Post()
  @RequireCapabilities(Capability.CUSTOMER_WRITE)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customersService.create(tenant, dto, idempotencyKey);
  }
}
