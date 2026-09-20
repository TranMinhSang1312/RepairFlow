/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../../common/auth/access-token.guard.js";
import { Capability } from "../../../common/permissions/capability.js";
import { PermissionGuard } from "../../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../../common/tenant/tenant.guard.js";
import { AssignTechnicianDto } from "./assignment.dto.js";
import { AssignmentsService } from "./assignments.service.js";

@Controller()
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.ASSIGNMENT_MANAGE)
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Get("technicians")
  listTechnicians(@CurrentTenant() tenant: TenantContext) {
    return this.assignmentsService.listTechnicians(tenant);
  }

  @Post("repair-orders/:repairOrderId/assignments")
  assign(
    @CurrentTenant() tenant: TenantContext,
    @Param("repairOrderId") repairOrderId: string,
    @Body() dto: AssignTechnicianDto,
  ) {
    return this.assignmentsService.assign(tenant, repairOrderId, dto);
  }
}
