import type { HealthResponse } from "@repairflow/contracts";
import { createServer, type Server, type ServerResponse } from "node:http";

import { workerHealth } from "../worker.js";
import type { WorkerMetrics } from "./worker-metrics.js";
import type { WorkerReadiness } from "./worker-readiness.js";

function json(response: ServerResponse, status: number, body: HealthResponse): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export class WorkerOperationsServer {
  private readonly server: Server;

  constructor(
    private readonly host: string,
    private readonly configuredPort: number,
    private readonly readiness: Pick<WorkerReadiness, "read">,
    private readonly metrics: Pick<WorkerMetrics, "prometheus">,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.server = createServer((request, response) => {
      void this.handle(request.method, request.url, response).catch(() => {
        if (response.headersSent) {
          response.end();
          return;
        }
        json(response, 503, {
          service: "worker",
          status: "unavailable",
          version: process.env.RELEASE_VERSION ?? "0.1.0",
          timestamp: this.clock().toISOString(),
          checks: { operations: "unavailable" },
        });
      });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(this.configuredPort, this.host, () => {
        this.server.off("error", onError);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    if (!this.server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  port(): number {
    const address = this.server.address();
    return typeof address === "object" && address ? address.port : this.configuredPort;
  }

  private async handle(
    method: string | undefined,
    rawUrl: string | undefined,
    response: ServerResponse,
  ): Promise<void> {
    if (method !== "GET") {
      response.writeHead(405, { Allow: "GET", "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const path = rawUrl?.split("?", 1)[0];
    if (path === "/health/live") {
      json(response, 200, workerHealth(this.clock()));
      return;
    }
    if (path === "/health/ready") {
      const health = await this.readiness.read();
      json(response, health.status === "ok" ? 200 : 503, health);
      return;
    }
    if (path === "/metrics") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      });
      response.end(this.metrics.prometheus());
      return;
    }
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
  }
}
