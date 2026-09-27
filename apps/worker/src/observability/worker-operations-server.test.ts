import { afterEach, describe, expect, it } from "vitest";

import { WorkerOperationsServer } from "./worker-operations-server.js";

describe("WorkerOperationsServer", () => {
  const servers: WorkerOperationsServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it("serves internal live, ready and Prometheus contracts without caching", async () => {
    const server = new WorkerOperationsServer(
      "127.0.0.1",
      0,
      {
        read: () =>
          Promise.resolve({
            service: "worker",
            status: "unavailable",
            version: "0.1.0",
            timestamp: "2026-09-27T01:00:00.000Z",
            checks: { database: "ok", polling: "stale" },
          }),
      },
      { prometheus: () => "repairflow_worker_polls_total 2\n" },
      () => new Date("2026-09-27T01:00:00.000Z"),
    );
    servers.push(server);
    await server.start();
    const base = `http://127.0.0.1:${server.port()}`;

    const live = await fetch(`${base}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ service: "worker", status: "ok" });
    expect(live.headers.get("cache-control")).toBe("no-store");

    const ready = await fetch(`${base}/health/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ checks: { polling: "stale" } });

    const metrics = await fetch(`${base}/metrics`);
    expect(metrics.headers.get("content-type")).toContain("text/plain");
    expect(await metrics.text()).toBe("repairflow_worker_polls_total 2\n");
    expect((await fetch(`${base}/unknown`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { method: "POST" })).status).toBe(405);
  });

  it("turns an unexpected readiness failure into a safe unavailable response", async () => {
    const server = new WorkerOperationsServer(
      "127.0.0.1",
      0,
      { read: () => Promise.reject(new Error("database password secret")) },
      { prometheus: () => "" },
      () => new Date("2026-09-27T01:00:00.000Z"),
    );
    servers.push(server);
    await server.start();

    const response = await fetch(`http://127.0.0.1:${server.port()}/health/ready`);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      service: "worker",
      status: "unavailable",
      checks: { operations: "unavailable" },
    });
    expect(body).not.toContain("password secret");
  });
});
