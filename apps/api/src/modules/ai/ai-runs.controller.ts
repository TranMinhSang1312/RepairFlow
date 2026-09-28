/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { ReviewAiRunDto } from "./ai.dto.js";
import { AiRunsService } from "./ai-runs.service.js";

@Controller("ai/runs")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.AI_ASSISTANCE_USE)
export class AiRunsController {
  constructor(private readonly service: AiRunsService) {}

  @Get(":aiRunId")
  get(@CurrentTenant() tenant: TenantContext, @Param("aiRunId") runId: string) {
    return this.service.get(tenant, runId);
  }

  @Post(":aiRunId/review")
  @HttpCode(HttpStatus.OK)
  review(
    @CurrentTenant() tenant: TenantContext,
    @Param("aiRunId") runId: string,
    @Body() dto: ReviewAiRunDto,
  ) {
    return this.service.review(tenant, runId, dto);
  }
}
