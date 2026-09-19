import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { CustomersController } from "./customers.controller.js";
import { CustomersRepository } from "./customers.repository.js";
import { CustomersService } from "./customers.service.js";

@Module({
  imports: [IdempotencyModule],
  controllers: [CustomersController],
  providers: [CustomersRepository, CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
