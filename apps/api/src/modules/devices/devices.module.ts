import { Module } from "@nestjs/common";

import { CustomersModule } from "../customers/customers.module.js";
import { DevicesController } from "./devices.controller.js";
import { DevicesRepository } from "./devices.repository.js";
import { DevicesService } from "./devices.service.js";

@Module({
  imports: [CustomersModule],
  controllers: [DevicesController],
  providers: [DevicesRepository, DevicesService],
})
export class DevicesModule {}
