/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime. */

import { Injectable } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";
import type { HealthResponse } from "@repairflow/contracts";

import { PrismaService } from "../infra/database/prisma.service.js";

@Injectable()
export class HealthService {
  private readonly version = parseApiEnvironment(process.env).RELEASE_VERSION;
  constructor(private readonly prisma: PrismaService) {}

  live(now = new Date()): HealthResponse {
    return this.response("ok", now);
  }

  async ready(now = new Date()): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.response("ok", now, { database: "ok" });
    } catch {
      return this.response("unavailable", now, { database: "unavailable" });
    }
  }

  private response(
    status: HealthResponse["status"],
    now: Date,
    checks?: NonNullable<HealthResponse["checks"]>,
  ): HealthResponse {
    return {
      service: "api",
      status,
      version: this.version,
      timestamp: now.toISOString(),
      ...(checks ? { checks } : {}),
    };
  }
}
