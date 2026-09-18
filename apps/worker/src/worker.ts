import type { HealthResponse } from "@repairflow/contracts";

export function workerHealth(now = new Date()): HealthResponse {
  return {
    service: "worker",
    status: "ok",
    version: "0.1.0",
    timestamp: now.toISOString(),
  };
}
