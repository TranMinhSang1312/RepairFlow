/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs Reflector at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { ApiException } from "../api-exception.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { ROLE_CAPABILITIES, type Capability } from "./capability.js";
import { REQUIRED_CAPABILITIES } from "./require-capabilities.decorator.js";

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenant = request.tenant;
    if (!tenant) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTH_REQUIRED",
        "Authentication and tenant selection are required.",
      );
    }

    const required = this.reflector.getAllAndMerge<Capability[]>(REQUIRED_CAPABILITIES, [
      context.getClass(),
      context.getHandler(),
    ]);
    const granted = ROLE_CAPABILITIES[tenant.role];

    if (required.length === 0 || !required.every((capability) => granted.has(capability))) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "PERMISSION_DENIED",
        "You do not have permission to perform this action.",
      );
    }

    return true;
  }
}
