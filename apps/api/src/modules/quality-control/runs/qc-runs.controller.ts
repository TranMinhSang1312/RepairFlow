/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Headers, Param, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../../common/auth/access-token.guard.js";
import { Capability } from "../../../common/permissions/capability.js";
import { PermissionGuard } from "../../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../../common/tenant/tenant.guard.js";
import { CreateQcRunDto } from "./qc-run.dto.js";
import { QcRunsService } from "./qc-runs.service.js";

@Controller("repair-orders/:repairOrderId/qc-runs")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.QC_RUN_SUBMIT)
export class QcRunsController {
  constructor(private readonly service: QcRunsService) {}

  @Post()
  submit(
    @CurrentTenant() tenant: TenantContext,
    @Param("repairOrderId") repairOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreateQcRunDto,
  ) {
    return this.service.submit(tenant, repairOrderId, dto, idempotencyKey);
  }
}
