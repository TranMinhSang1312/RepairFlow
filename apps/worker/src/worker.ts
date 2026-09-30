import type { HealthResponse } from "@repairflow/contracts";

export function workerHealth(now = new Date()): HealthResponse {
  return {
    service: "worker",
    status: "ok",
    version: process.env.RELEASE_VERSION ?? "0.1.0",
    timestamp: now.toISOString(),
  };
}
