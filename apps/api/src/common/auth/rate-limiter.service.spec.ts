import { HttpStatus } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaService } from "../../infra/database/prisma.service.js";
import { ApiException } from "../api-exception.js";
import { RateLimiterService } from "./rate-limiter.service.js";

describe("RateLimiterService", () => {
  const prisma = new PrismaService();
  const limiter = new RateLimiterService(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects calls after a policy is exhausted", async () => {
    const policy = { limit: 2, windowMs: 60_000 };
    const key = `test-key:${randomUUID()}`;

    await limiter.assertAllowed(key, policy);
    await limiter.assertAllowed(key, policy);

    try {
      await limiter.assertAllowed(key, policy);
      throw new Error("expected the rate limit to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((error as ApiException).responseHeaders["Retry-After"]).toBe("60");
    }
  });
});
