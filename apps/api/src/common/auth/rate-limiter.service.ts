import { Injectable, HttpStatus } from "@nestjs/common";

import { ApiException } from "../api-exception.js";

const CLEANUP_THRESHOLD = 100;
const MAX_BUCKETS = 10_000;

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimiterService {
  private readonly buckets = new Map<string, Bucket>();

  assertAllowed(key: string, policy: RateLimitPolicy): void {
    const now = Date.now();
    if (this.buckets.size >= CLEANUP_THRESHOLD) {
      this.removeExpired(now);
    }
    if (!this.buckets.has(key) && this.buckets.size >= MAX_BUCKETS) {
      this.removeOldestBucket();
    }
    const current = this.buckets.get(key);
    const bucket =
      !current || current.resetAt <= now ? { count: 0, resetAt: now + policy.windowMs } : current;

    if (bucket.count >= policy.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        "RATE_LIMITED",
        "Too many attempts. Please try again later.",
        undefined,
        { "Retry-After": String(retryAfterSeconds) },
      );
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);
  }

  clear(): void {
    this.buckets.clear();
  }

  private removeExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  private removeOldestBucket(): void {
    let oldestKey: string | undefined;
    let oldestResetAt = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt < oldestResetAt) {
        oldestKey = key;
        oldestResetAt = bucket.resetAt;
      }
    }
    if (oldestKey) {
      this.buckets.delete(oldestKey);
    }
  }
}
