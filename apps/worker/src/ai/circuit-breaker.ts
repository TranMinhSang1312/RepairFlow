import { AiGatewayError } from "./ai-errors.js";

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  provider: string;
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

export interface CircuitBreakerSnapshot {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  openedAtMs?: number;
  halfOpenProbeInFlight: boolean;
}

export interface CircuitBreakerPermit {
  success(): void;
  failure(): void;
}

/** In-process provider availability breaker. It never stores request or response content. */
export class CircuitBreaker {
  private state: CircuitBreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAtMs: number | undefined;
  private halfOpenProbeInFlight = false;
  private epoch = 0;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    if (!Number.isInteger(options.failureThreshold) || options.failureThreshold < 1) {
      throw new RangeError("failureThreshold must be a positive integer");
    }
    if (!Number.isFinite(options.cooldownMs) || options.cooldownMs <= 0) {
      throw new RangeError("cooldownMs must be positive");
    }
    this.now = options.now ?? Date.now;
  }

  acquire(): CircuitBreakerPermit {
    this.moveToHalfOpenWhenCooldownElapsed();

    if (this.state === "OPEN" || (this.state === "HALF_OPEN" && this.halfOpenProbeInFlight)) {
      throw new AiGatewayError("AI_PROVIDER_CIRCUIT_OPEN", {
        provider: this.options.provider,
        outcome: "NOT_STARTED",
        retryDisposition: "SAFE_BEFORE_INFERENCE",
      });
    }

    if (this.state === "HALF_OPEN") {
      this.halfOpenProbeInFlight = true;
    }

    const acquiredState = this.state;
    const acquiredEpoch = this.epoch;
    let settled = false;

    return {
      success: () => {
        if (settled) return;
        settled = true;
        this.recordSuccess(acquiredState, acquiredEpoch);
      },
      failure: () => {
        if (settled) return;
        settled = true;
        this.recordFailure(acquiredState, acquiredEpoch);
      },
    };
  }

  snapshot(): CircuitBreakerSnapshot {
    this.moveToHalfOpenWhenCooldownElapsed();
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      ...(this.openedAtMs === undefined ? {} : { openedAtMs: this.openedAtMs }),
      halfOpenProbeInFlight: this.halfOpenProbeInFlight,
    };
  }

  private moveToHalfOpenWhenCooldownElapsed(): void {
    if (
      this.state === "OPEN" &&
      this.openedAtMs !== undefined &&
      this.now() - this.openedAtMs >= this.options.cooldownMs
    ) {
      this.state = "HALF_OPEN";
      this.halfOpenProbeInFlight = false;
    }
  }

  private recordSuccess(acquiredState: CircuitBreakerState, acquiredEpoch: number): void {
    // A stale request that started before the breaker opened must not close it afterwards.
    if (acquiredEpoch !== this.epoch) return;
    if (acquiredState === "HALF_OPEN" || this.state === "CLOSED") {
      this.state = "CLOSED";
      this.consecutiveFailures = 0;
      this.openedAtMs = undefined;
      this.halfOpenProbeInFlight = false;
    }
  }

  private recordFailure(acquiredState: CircuitBreakerState, acquiredEpoch: number): void {
    if (acquiredEpoch !== this.epoch) return;
    if (acquiredState === "HALF_OPEN") {
      this.open();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.state = "OPEN";
    this.openedAtMs = this.now();
    this.halfOpenProbeInFlight = false;
    this.epoch += 1;
  }
}
