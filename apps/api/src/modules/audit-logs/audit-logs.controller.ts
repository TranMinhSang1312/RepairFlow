/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime validation metadata. */

import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import { ListAuditLogsQueryDto } from "./audit-logs.dto.js";
import { AuditLogsService } from "./audit-logs.service.js";

@Controller("operations/audit-logs")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.AUDIT_LOG_READ)
export class AuditLogsController {
  constructor(private readonly service: AuditLogsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext, @Query() query: ListAuditLogsQueryDto) {
    return this.service.list(tenant, query);
  }

  @Get(":auditLogId")
  detail(@CurrentTenant() tenant: TenantContext, @Param("auditLogId") id: string) {
    return this.service.detail(tenant, id);
  }
}
