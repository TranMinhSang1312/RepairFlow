/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { Injectable, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { parseApiEnvironment } from "@repairflow/config";
import { createHmac } from "node:crypto";

import { ApiException } from "../api-exception.js";
import { PrismaService } from "../../infra/database/prisma.service.js";

const MAX_CONCURRENCY_RETRIES = 12;

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

@Injectable()
export class RateLimiterService {
  private readonly environment = parseApiEnvironment(process.env);

  constructor(private readonly prisma: PrismaService) {}

  async assertAllowed(key: string, policy: RateLimitPolicy): Promise<void> {
    const keyHash = createHmac("sha256", this.environment.ACCESS_TOKEN_SECRET)
      .update(`${this.environment.RATE_LIMIT_NAMESPACE}:${key}`)
      .digest("hex");

    for (let attempt = 0; attempt < MAX_CONCURRENCY_RETRIES; attempt += 1) {
      const now = new Date();
      const current = await this.prisma.rateLimitBucket.findUnique({ where: { keyHash } });

      if (!current) {
        try {
          await this.prisma.rateLimitBucket.create({
            data: { keyHash, count: 1, resetAt: new Date(now.getTime() + policy.windowMs) },
          });
          return;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            continue;
          }
          throw error;
        }
      }

      if (current.resetAt <= now) {
        const reset = await this.prisma.rateLimitBucket.updateMany({
          where: { keyHash, count: current.count, resetAt: current.resetAt },
          data: { count: 1, resetAt: new Date(now.getTime() + policy.windowMs) },
        });
        if (reset.count === 1) return;
        continue;
      }

      if (current.count >= policy.limit) {
        this.reject(current.resetAt.getTime() - now.getTime());
      }

      const incremented = await this.prisma.rateLimitBucket.updateMany({
        where: { keyHash, count: current.count, resetAt: current.resetAt },
        data: { count: { increment: 1 } },
      });
      if (incremented.count === 1) return;
    }

    // Fail closed when a bucket is under extreme contention. This protects auth and public
    // endpoints without relying on process-local state.
    this.reject(1_000);
  }

  async clear(): Promise<void> {
    await this.prisma.rateLimitBucket.deleteMany();
  }

  private reject(remainingMs: number): never {
    const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    throw new ApiException(
      HttpStatus.TOO_MANY_REQUESTS,
      "RATE_LIMITED",
      "Too many attempts. Please try again later.",
      undefined,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }
}
