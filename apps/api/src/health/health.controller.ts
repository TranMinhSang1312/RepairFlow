import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@repairflow/contracts";

@Controller("health")
export class HealthController {
  @Get()
  health(): HealthResponse {
    return {
      service: "api",
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    };
  }
}
