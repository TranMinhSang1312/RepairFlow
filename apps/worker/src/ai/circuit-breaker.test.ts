import { describe, expect, it } from "vitest";
import { AiGatewayError } from "./ai-errors.js";
import { CircuitBreaker } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("opens at the threshold and blocks work before inference", () => {
    let now = 100;
    const breaker = new CircuitBreaker({
      provider: "deepseek/deepseek-flash",
      failureThreshold: 2,
      cooldownMs: 1_000,
      now: () => now,
    });

    breaker.acquire().failure();
    expect(breaker.snapshot()).toMatchObject({ state: "CLOSED", consecutiveFailures: 1 });
    breaker.acquire().failure();
    expect(breaker.snapshot()).toMatchObject({ state: "OPEN", openedAtMs: 100 });

    expect(() => breaker.acquire()).toThrowError(AiGatewayError);
    try {
      breaker.acquire();
    } catch (error) {
      expect(error).toMatchObject({
        code: "AI_PROVIDER_CIRCUIT_OPEN",
        outcome: "NOT_STARTED",
        retryDisposition: "SAFE_BEFORE_INFERENCE",
      });
    }
    now += 999;
    expect(() => breaker.acquire()).toThrowError(AiGatewayError);
  });

  it("allows one half-open probe and closes after success", () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      provider: "deepseek",
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => now,
    });
    breaker.acquire().failure();
    now = 100;

    const probe = breaker.acquire();
    expect(breaker.snapshot()).toMatchObject({ state: "HALF_OPEN", halfOpenProbeInFlight: true });
    expect(() => breaker.acquire()).toThrowError(AiGatewayError);
    probe.success();
    expect(breaker.snapshot()).toEqual({
      state: "CLOSED",
      consecutiveFailures: 0,
      halfOpenProbeInFlight: false,
    });
  });

  it("reopens on a failed half-open probe", () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      provider: "deepseek",
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => now,
    });
    breaker.acquire().failure();
    now = 100;
    breaker.acquire().failure();
    expect(breaker.snapshot()).toMatchObject({ state: "OPEN", openedAtMs: 100 });
  });

  it("ignores a stale success from a request that predates opening", () => {
    const breaker = new CircuitBreaker({
      provider: "deepseek",
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => 0,
    });
    const failing = breaker.acquire();
    const staleSuccess = breaker.acquire();
    failing.failure();
    staleSuccess.success();
    expect(breaker.snapshot().state).toBe("OPEN");
  });

  it("validates its configuration", () => {
    expect(
      () => new CircuitBreaker({ provider: "deepseek", failureThreshold: 0, cooldownMs: 1 }),
    ).toThrow("failureThreshold");
    expect(
      () => new CircuitBreaker({ provider: "deepseek", failureThreshold: 1, cooldownMs: 0 }),
    ).toThrow("cooldownMs");
  });
});
