import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { ApiException } from "../api-exception.js";
import { RateLimiterService } from "./rate-limiter.service.js";

describe("RateLimiterService", () => {
  it("rejects calls after a policy is exhausted", () => {
    const limiter = new RateLimiterService();
    const policy = { limit: 2, windowMs: 60_000 };

    limiter.assertAllowed("test-key", policy);
    limiter.assertAllowed("test-key", policy);

    try {
      limiter.assertAllowed("test-key", policy);
      throw new Error("expected the rate limit to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((error as ApiException).responseHeaders["Retry-After"]).toBe("60");
    }
  });
});
