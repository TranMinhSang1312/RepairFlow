/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Headers, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import {
  CreatePartRequirementDto,
  CreatePartUsedDto,
  CreateWorkLogDto,
  UpdatePartRequirementDto,
} from "./service-execution.dto.js";
import { ServiceExecutionService } from "./service-execution.service.js";

@Controller()
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.SERVICE_EXECUTION_WRITE)
export class ServiceExecutionController {
  constructor(private readonly service: ServiceExecutionService) {}

  @Post("repair-orders/:repairOrderId/work-logs")
  createWorkLog(
    @CurrentTenant() tenant: TenantContext,
    @Param("repairOrderId") repairOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreateWorkLogDto,
  ) {
    return this.service.createWorkLog(tenant, repairOrderId, dto, idempotencyKey);
  }

  @Post("repair-orders/:repairOrderId/part-requirements")
  createPartRequirement(
    @CurrentTenant() tenant: TenantContext,
    @Param("repairOrderId") repairOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreatePartRequirementDto,
  ) {
    return this.service.createPartRequirement(tenant, repairOrderId, dto, idempotencyKey);
  }

  @Patch("part-requirements/:partRequirementId")
  updatePartRequirement(
    @CurrentTenant() tenant: TenantContext,
    @Param("partRequirementId") partRequirementId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: UpdatePartRequirementDto,
  ) {
    return this.service.updatePartRequirement(tenant, partRequirementId, dto, idempotencyKey);
  }

  @Post("repair-orders/:repairOrderId/parts-used")
  createPartUsed(
    @CurrentTenant() tenant: TenantContext,
    @Param("repairOrderId") repairOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreatePartUsedDto,
  ) {
    return this.service.createPartUsed(tenant, repairOrderId, dto, idempotencyKey);
  }
}
