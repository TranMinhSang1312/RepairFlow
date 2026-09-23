import { Module } from "@nestjs/common";

import { RateLimiterService } from "./rate-limiter.service.js";

@Module({
  providers: [RateLimiterService],
  exports: [RateLimiterService],
})
export class RateLimiterModule {}
