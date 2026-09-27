import { describe, expect, it, vi } from "vitest";

import { HealthService } from "./health.service.js";

describe("HealthService", () => {
  it("keeps liveness independent from dependencies", () => {
    const query = vi.fn();
    const service = new HealthService({ $queryRaw: query } as never);
    expect(service.live(new Date("2026-09-27T00:00:00.000Z"))).toEqual({
      service: "api",
      status: "ok",
      version: "0.1.0",
      timestamp: "2026-09-27T00:00:00.000Z",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns an allowlisted unavailable readiness response when PostgreSQL fails", async () => {
    const service = new HealthService({
      $queryRaw: vi.fn().mockRejectedValue(new Error("password=database-secret")),
    } as never);
    const response = await service.ready(new Date("2026-09-27T00:00:00.000Z"));
    expect(response).toEqual({
      service: "api",
      status: "unavailable",
      version: "0.1.0",
      timestamp: "2026-09-27T00:00:00.000Z",
      checks: { database: "unavailable" },
    });
    expect(JSON.stringify(response)).not.toContain("database-secret");
  });
});
