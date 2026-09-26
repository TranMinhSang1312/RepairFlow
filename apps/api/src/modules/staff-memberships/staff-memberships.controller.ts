/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.types.js";
import { RefreshCookieService } from "../../common/auth/refresh-cookie.service.js";
import { Capability } from "../../common/permissions/capability.js";
import { PermissionGuard } from "../../common/permissions/permission.guard.js";
import { RequireCapabilities } from "../../common/permissions/require-capabilities.decorator.js";
import { CurrentTenant } from "../../common/tenant/current-tenant.decorator.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { TenantGuard } from "../../common/tenant/tenant.guard.js";
import {
  AcceptNewStaffInvitationDto,
  CreateStaffInvitationDto,
  ListStaffMembershipsQueryDto,
  UpdateStaffMembershipDto,
  VersionedInvitationDto,
} from "./staff-membership.dto.js";
import { StaffMembershipsService } from "./staff-memberships.service.js";

@Controller()
export class StaffMembershipsController {
  constructor(
    private readonly service: StaffMembershipsService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  @Get("staff-memberships")
  @UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
  @RequireCapabilities(Capability.STAFF_MEMBERSHIP_READ)
  listMemberships(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListStaffMembershipsQueryDto,
  ) {
    return this.service.listMemberships(tenant, query);
  }

  @Patch("staff-memberships/:userId")
  @UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
  @RequireCapabilities(Capability.STAFF_MEMBERSHIP_MANAGE)
  updateMembership(
    @CurrentTenant() tenant: TenantContext,
    @Param("userId") userId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: UpdateStaffMembershipDto,
  ) {
    return this.service.updateMembership(tenant, userId, dto, key);
  }

  @Get("staff-invitations")
  @UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
  @RequireCapabilities(Capability.STAFF_MEMBERSHIP_MANAGE)
  listInvitations(@CurrentTenant() tenant: TenantContext) {
    return this.service.listInvitations(tenant);
  }

  @Post("staff-invitations")
  @UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
  @RequireCapabilities(Capability.STAFF_MEMBERSHIP_MANAGE)
  createInvitation(
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: CreateStaffInvitationDto,
  ) {
    return this.service.createInvitation(tenant, dto, key);
  }

  @Post("staff-invitations/:invitationId/reissue")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
  @RequireCapabilities(Capability.STAFF_MEMBERSHIP_MANAGE)
  reissueInvitation(
    @CurrentTenant() tenant: TenantContext,
    @Param("invitationId") invitationId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: VersionedInvitationDto,
  ) {
    return this.service.reissueInvitation(tenant, invitationId, dto, key);
  }

  @Post("staff-invitations/:invitationId/revoke")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, TenantGuard, PermissionGuard)
  @RequireCapabilities(Capability.STAFF_MEMBERSHIP_MANAGE)
  revokeInvitation(
    @CurrentTenant() tenant: TenantContext,
    @Param("invitationId") invitationId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: VersionedInvitationDto,
  ) {
    return this.service.revokeInvitation(tenant, invitationId, dto, key);
  }

  @Get("public/v1/staff-invitation")
  inspectInvitation(
    @Headers("x-repairflow-invitation-token") token: string | undefined,
    @Req() request: Request,
  ) {
    return this.service.inspectInvitation(token, request);
  }

  @Post("public/v1/staff-invitation/accept")
  @HttpCode(HttpStatus.CREATED)
  async acceptNewInvitation(
    @Headers("x-repairflow-invitation-token") token: string | undefined,
    @Body() dto: AcceptNewStaffInvitationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.service.acceptNewInvitation(token, dto, request);
    this.refreshCookie.set(response, issued.refreshToken);
    return issued.response;
  }

  @Post("staff-invitations/accept")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  acceptExistingInvitation(
    @Headers("x-repairflow-invitation-token") token: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.acceptExistingInvitation(token, request.auth!.userId, request);
  }
}
