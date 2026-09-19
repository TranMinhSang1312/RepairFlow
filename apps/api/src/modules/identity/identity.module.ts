import { Module } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { PasswordHasherService } from "../../common/auth/password-hasher.service.js";
import { RateLimiterService } from "../../common/auth/rate-limiter.service.js";
import { RefreshCookieService } from "../../common/auth/refresh-cookie.service.js";
import { TokenService } from "../../common/auth/token.service.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";

@Module({
  controllers: [IdentityController],
  providers: [
    IdentityService,
    PasswordHasherService,
    TokenService,
    RefreshCookieService,
    RateLimiterService,
    AccessTokenGuard,
  ],
  exports: [AccessTokenGuard, TokenService],
})
export class IdentityModule {}
