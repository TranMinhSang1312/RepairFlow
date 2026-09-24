/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { AccessTokenGuard } from "../../../common/auth/access-token.guard.js";
import { Capability } from "../../../common/permissions/capability.js";
import { PermissionGuard } from "../../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../../common/tenant/tenant.guard.js";
import { CreateQcTemplateDto, ListQcTemplatesQueryDto } from "./qc-template.dto.js";
import { QcTemplatesService } from "./qc-templates.service.js";

@Controller("qc-templates")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
export class QcTemplatesController {
  constructor(private readonly service: QcTemplatesService) {}

  @Get()
  @RequireCapabilities(Capability.QC_TEMPLATE_READ)
  list(@CurrentTenant() tenant: TenantContext, @Query() query: ListQcTemplatesQueryDto) {
    return this.service.list(tenant, query.includeInactive);
  }

  @Post()
  @RequireCapabilities(Capability.QC_TEMPLATE_MANAGE)
  publish(
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreateQcTemplateDto,
  ) {
    return this.service.publish(tenant, dto, idempotencyKey);
  }

  @Post(":qcTemplateId/deactivate")
  @HttpCode(HttpStatus.OK)
  @RequireCapabilities(Capability.QC_TEMPLATE_MANAGE)
  deactivate(
    @CurrentTenant() tenant: TenantContext,
    @Param("qcTemplateId") qcTemplateId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    return this.service.deactivate(tenant, qcTemplateId, idempotencyKey);
  }
}
