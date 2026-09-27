/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

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

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import {
  ListNotificationOperationsQueryDto,
  RetryNotificationOperationDto,
} from "./notification-operation.dto.js";
import { NotificationOperationsService } from "./notification-operations.service.js";

@Controller("operations/notifications")
@UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
@RequireCapabilities(Capability.NOTIFICATION_OPERATIONS_MANAGE)
export class NotificationOperationsController {
  constructor(private readonly service: NotificationOperationsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext, @Query() query: ListNotificationOperationsQueryDto) {
    return this.service.list(tenant, query);
  }

  @Get(":outboxEventId")
  detail(@CurrentTenant() tenant: TenantContext, @Param("outboxEventId") eventId: string) {
    return this.service.detail(tenant, eventId);
  }

  @Post(":outboxEventId/retry")
  @HttpCode(HttpStatus.OK)
  retry(
    @CurrentTenant() tenant: TenantContext,
    @Param("outboxEventId") eventId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: RetryNotificationOperationDto,
  ) {
    return this.service.retry(tenant, eventId, dto, key);
  }
}
