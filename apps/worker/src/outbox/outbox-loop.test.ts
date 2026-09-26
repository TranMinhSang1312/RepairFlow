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
    const loop = new OutboxLoop({ runOnce }, logger, 1000);

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
  });
});
