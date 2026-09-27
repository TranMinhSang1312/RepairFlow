import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboxLoop } from "./outbox-loop.js";
import type { OutboxRunSummary, WorkerLogger } from "./outbox.types.js";

const emptySummary: OutboxRunSummary = {
  claimed: 0,
  completed: 0,
  retried: 0,
  deadLettered: 0,
};

const logger: WorkerLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("OutboxLoop", () => {
  afterEach(() => vi.useRealTimers());

  it("does not overlap polls and stops before scheduling another run", async () => {
    vi.useFakeTimers();
    let finishFirst: ((summary: OutboxRunSummary) => void) | undefined;
    const firstRun = new Promise<OutboxRunSummary>((resolve) => {
      finishFirst = resolve;
    });
    const runOnce = vi
      .fn<() => Promise<OutboxRunSummary>>()
      .mockReturnValueOnce(firstRun)
      .mockResolvedValue(emptySummary);
    const observer = {
      pollStarted: vi.fn(),
      pollSucceeded: vi.fn(),
      pollFailed: vi.fn(),
    };
    const loop = new OutboxLoop({ runOnce }, logger, 1000, observer);

    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(runOnce).toHaveBeenCalledTimes(1);

    finishFirst?.(emptySummary);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(2);

    await loop.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(observer.pollStarted).toHaveBeenCalledTimes(2);
    expect(observer.pollSucceeded).toHaveBeenCalledTimes(2);
    expect(observer.pollFailed).not.toHaveBeenCalled();
  });

  it("records a failed poll without leaking the thrown error", async () => {
    vi.useFakeTimers();
    const observer = {
      pollStarted: vi.fn(),
      pollSucceeded: vi.fn(),
      pollFailed: vi.fn(),
    };
    const error = vi.fn();
    const loop = new OutboxLoop(
      { runOnce: vi.fn().mockRejectedValue(new Error("provider-body-secret")) },
      { ...logger, error },
      1000,
      observer,
    );
    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    await loop.stop();
    expect(observer.pollFailed).toHaveBeenCalledOnce();
    expect(observer.pollSucceeded).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain("provider-body-secret");
  });
});
