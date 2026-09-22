import { Module } from "@nestjs/common";

import { PublicTokenService } from "./public-token.service.js";

@Module({
  providers: [PublicTokenService],
  exports: [PublicTokenService],
})
export class PublicAccessModule {}
