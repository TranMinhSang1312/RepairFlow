import { describe, expect, it, vi } from "vitest";

import { WorkerReadiness } from "./worker-readiness.js";

describe("WorkerReadiness", () => {
  const now = new Date("2026-09-27T01:00:00.000Z");

  it("is unavailable before the first successful poll and when polling becomes stale", async () => {
    const snapshot = vi
      .fn()
      .mockReturnValueOnce({ lastPollCompletedAt: null, lastPollSucceededAt: null })
      .mockReturnValueOnce({
        lastPollCompletedAt: new Date(now.getTime() - 30_001),
        lastPollSucceededAt: new Date(now.getTime() - 30_001),
      });
    const readiness = new WorkerReadiness(
      vi.fn().mockResolvedValue(undefined),
      { snapshot },
      30_000,
      () => now,
    );
    await expect(readiness.read()).resolves.toMatchObject({
      status: "unavailable",
      checks: { database: "ok", polling: "stale" },
    });
    await expect(readiness.read()).resolves.toMatchObject({
      status: "unavailable",
      checks: { database: "ok", polling: "stale" },
    });
  });

  it("requires both a fresh poll and PostgreSQL", async () => {
    const metrics = { snapshot: () => ({ lastPollCompletedAt: now, lastPollSucceededAt: now }) };
    await expect(
      new WorkerReadiness(vi.fn().mockResolvedValue(undefined), metrics, 30_000, () => now).read(),
    ).resolves.toMatchObject({ status: "ok", checks: { database: "ok", polling: "ok" } });
    const failed = await new WorkerReadiness(
      vi.fn().mockRejectedValue(new Error("database password secret")),
      metrics,
      30_000,
      () => now,
    ).read();
    expect(failed).toMatchObject({
      status: "unavailable",
      checks: { database: "unavailable", polling: "ok" },
    });
    expect(JSON.stringify(failed)).not.toContain("password secret");
  });

  it("becomes unavailable when the latest completed poll failed", async () => {
    const metrics = {
      snapshot: () => ({
        lastPollSucceededAt: new Date(now.getTime() - 1_000),
        lastPollCompletedAt: now,
      }),
    };

    await expect(
      new WorkerReadiness(vi.fn().mockResolvedValue(undefined), metrics, 30_000, () => now).read(),
    ).resolves.toMatchObject({
      status: "unavailable",
      checks: { database: "ok", polling: "stale" },
    });
  });
});
