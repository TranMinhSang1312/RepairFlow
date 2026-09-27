import { describe, expect, it, vi } from "vitest";

import type { WorkerLogger } from "../outbox/outbox.types.js";
import { WorkerMetrics } from "./worker-metrics.js";

function logger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies WorkerLogger;
}

describe("WorkerMetrics", () => {
  it("tracks low-cardinality poll outcomes and renders Prometheus text", () => {
    const log = logger();
    const metrics = new WorkerMetrics(log, 3, 1, () => new Date("2026-09-27T01:00:00.000Z"));
    metrics.pollStarted();
    metrics.pollSucceeded({ claimed: 4, completed: 2, retried: 1, deadLettered: 1 });

    expect(metrics.snapshot()).toMatchObject({
      pollsTotal: 1,
      claimedTotal: 4,
      completedTotal: 2,
      retriedTotal: 1,
      deadLetteredTotal: 1,
      inFlight: 0,
      consecutivePollFailures: 0,
    });
    const output = metrics.prometheus();
    expect(output).toContain("repairflow_worker_dead_lettered_total 1");
    expect(output).toContain("repairflow_worker_last_success_unixtime_seconds 1790470800");
    expect(output).not.toMatch(/[{}]|shop|recipient|token|payload/iu);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ alertCode: "OUTBOX_DEAD_LETTER_THRESHOLD" }),
      "Worker alert threshold reached",
    );
  });

  it("deduplicates consecutive failure alerts and re-arms after success", () => {
    const log = logger();
    const metrics = new WorkerMetrics(log, 2, 1);
    metrics.pollFailed();
    metrics.pollFailed();
    metrics.pollFailed();
    expect(log.error).toHaveBeenCalledTimes(1);
    metrics.pollSucceeded({ claimed: 0, completed: 0, retried: 0, deadLettered: 0 });
    metrics.pollFailed();
    metrics.pollFailed();
    expect(log.error).toHaveBeenCalledTimes(2);
  });
});
