/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime metadata. */

import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import type { HealthResponse } from "@repairflow/contracts";
import type { Response } from "express";

import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  health(): HealthResponse {
    return this.healthService.live();
  }

  @Get("live")
  live(): HealthResponse {
    return this.healthService.live();
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const health = await this.healthService.ready();
    response.status(health.status === "ok" ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return health;
  }
}
