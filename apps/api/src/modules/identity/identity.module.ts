import { Module } from "@nestjs/common";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import { PasswordHasherService } from "../../common/auth/password-hasher.service.js";
import { RateLimiterModule } from "../../common/auth/rate-limiter.module.js";
import { RefreshCookieService } from "../../common/auth/refresh-cookie.service.js";
import { TokenService } from "../../common/auth/token.service.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";

@Module({
  imports: [RateLimiterModule],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    PasswordHasherService,
    TokenService,
    RefreshCookieService,
    AccessTokenGuard,
  ],
  exports: [AccessTokenGuard, TokenService],
})
export class IdentityModule {}
