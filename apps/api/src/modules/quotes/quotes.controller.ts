/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { CreateQuoteDto } from "./quote.dto.js";
import { QuotesService } from "./quotes.service.js";

@Controller()
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.QUOTE_DRAFT_WRITE)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post("repair-orders/:repairOrderId/quotes")
  create(
    @CurrentTenant() tenant: TenantContext,
    @Param("repairOrderId") repairOrderId: string,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotesService.create(tenant, repairOrderId, dto);
  }

  @Patch("quotes/:quoteVersionId")
  replace(
    @CurrentTenant() tenant: TenantContext,
    @Param("quoteVersionId") quoteVersionId: string,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotesService.replace(tenant, quoteVersionId, dto);
  }
}
