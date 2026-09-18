import { describe, expect, it } from "vitest";

import { workerHealth } from "./worker";

describe("worker health", () => {
  it("returns a deterministic health payload", () => {
    expect(workerHealth(new Date("2026-09-18T00:00:00.000Z"))).toEqual({
      service: "worker",
      status: "ok",
      version: "0.1.0",
      timestamp: "2026-09-18T00:00:00.000Z",
    });
  });
});
