import { createParamDecorator, HttpStatus } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import { ApiException } from "../api-exception.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import type { TenantContext } from "./tenant-context.js";

export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const tenant = context.switchToHttp().getRequest<AuthenticatedRequest>().tenant;
    if (!tenant) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTH_REQUIRED",
        "Authentication and tenant selection are required.",
      );
    }

    return tenant;
  },
);
