import type { HealthResponse } from "@repairflow/contracts";

import type { WorkerMetricSnapshot } from "./worker-metrics.js";

interface PollFreshnessSource {
  snapshot(): Pick<WorkerMetricSnapshot, "lastPollCompletedAt" | "lastPollSucceededAt">;
}

export class WorkerReadiness {
  constructor(
    private readonly databaseProbe: () => Promise<void>,
    private readonly metrics: PollFreshnessSource,
    private readonly staleAfterMs: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async read(): Promise<HealthResponse> {
    const now = this.clock();
    let database: "ok" | "unavailable" = "ok";
    try {
      await this.databaseProbe();
    } catch {
      database = "unavailable";
    }
    const snapshot = this.metrics.snapshot();
    const lastSuccess = snapshot.lastPollSucceededAt;
    const latestPollSucceeded =
      lastSuccess &&
      (!snapshot.lastPollCompletedAt ||
        lastSuccess.getTime() >= snapshot.lastPollCompletedAt.getTime());
    const polling =
      latestPollSucceeded && now.getTime() - lastSuccess.getTime() <= this.staleAfterMs
        ? "ok"
        : "stale";
    return {
      service: "worker",
      status: database === "ok" && polling === "ok" ? "ok" : "unavailable",
      version: "0.1.0",
      timestamp: now.toISOString(),
      checks: { database, polling },
    };
  }
}
