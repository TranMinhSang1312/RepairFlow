/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { CreateQuoteDto, SendQuoteDto } from "./quote.dto.js";
import { QuotesService } from "./quotes.service.js";

@Controller()
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post("repair-orders/:repairOrderId/quotes")
  @RequireCapabilities(Capability.QUOTE_DRAFT_WRITE)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Param("repairOrderId") repairOrderId: string,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotesService.create(tenant, repairOrderId, dto);
  }

  @Patch("quotes/:quoteVersionId")
  @RequireCapabilities(Capability.QUOTE_DRAFT_WRITE)
  replace(
    @CurrentTenant() tenant: TenantContext,
    @Param("quoteVersionId") quoteVersionId: string,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotesService.replace(tenant, quoteVersionId, dto);
  }

  @Post("quotes/:quoteVersionId/send")
  @HttpCode(HttpStatus.OK)
  @RequireCapabilities(Capability.QUOTE_SEND)
  send(
    @CurrentTenant() tenant: TenantContext,
    @Param("quoteVersionId") quoteVersionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: SendQuoteDto,
  ) {
    return this.quotesService.send(tenant, quoteVersionId, dto, idempotencyKey);
  }
}
