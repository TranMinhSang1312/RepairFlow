import type { HealthResponse } from "@repairflow/contracts";

export function GET(): Response {
  const health: HealthResponse = {
    service: "web",
    status: "ok",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  };

  return Response.json(health);
}
