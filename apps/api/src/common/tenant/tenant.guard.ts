/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { MembershipStatus, UserStatus } from "@prisma/client";

import { ApiException } from "../api-exception.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { PrismaService } from "../../infra/database/prisma.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.auth?.userId;
    if (!userId) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTH_REQUIRED",
        "Authentication is required.",
      );
    }

    const rawShopId = request.headers["x-shop-id"];
    if (typeof rawShopId !== "string" || rawShopId.length === 0) {
      throw this.invalidShopHeader("REQUIRED", "X-Shop-Id is required.");
    }

    const shopId = rawShopId.trim().toLowerCase();
    if (!UUID_PATTERN.test(shopId)) {
      throw this.invalidShopHeader("INVALID_FORMAT", "X-Shop-Id must be a UUID.");
    }

    const membership = await this.prisma.shopMembership.findUnique({
      where: { shopId_userId: { shopId, userId } },
      select: { role: true, status: true, user: { select: { status: true } } },
    });

    if (!membership) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "SHOP_NOT_FOUND",
        "The selected shop is unavailable.",
      );
    }

    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "MEMBERSHIP_INACTIVE",
        "The membership for the selected shop is inactive.",
      );
    }

    if (membership.user.status !== UserStatus.ACTIVE) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTH_REQUIRED",
        "Authentication is required.",
      );
    }

    request.tenant = {
      userId,
      shopId,
      role: membership.role,
      requestId: String(request.id ?? "unknown"),
    };
    return true;
  }

  private invalidShopHeader(code: string, message: string): ApiException {
    return new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "VALIDATION_FAILED",
      "One or more input fields are invalid.",
      [{ field: "X-Shop-Id", code, message }],
    );
  }
}
