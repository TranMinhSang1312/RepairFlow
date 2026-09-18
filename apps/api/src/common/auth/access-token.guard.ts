/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs the token service at runtime for DI. */

import { Injectable, HttpStatus } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";

import { ApiException } from "../api-exception.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import { TokenService } from "./token.service.js";

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const parts = authorization?.split(" ") ?? [];
    const scheme = parts[0];
    const token = parts[1];
    const claims =
      parts.length === 2 && scheme?.toLowerCase() === "bearer" && token
        ? this.tokenService.verifyAccessToken(token)
        : null;

    if (!claims) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTH_REQUIRED",
        "Authentication is required.",
      );
    }

    request.auth = { userId: claims.sub };
    return true;
  }
}
