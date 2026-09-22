import { Module } from "@nestjs/common";

import { QuotesController } from "./quotes.controller.js";
import { QuotesRepository } from "./quotes.repository.js";
import { QuotesService } from "./quotes.service.js";

@Module({
  controllers: [QuotesController],
  providers: [QuotesRepository, QuotesService],
})
export class QuotesModule {}
