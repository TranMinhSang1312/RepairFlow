import { parseWorkerEnvironment } from "@repairflow/config";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import pino from "pino";

import { workerHealth } from "./worker";

loadWorkspaceEnvironment();
const environment = parseWorkerEnvironment(process.env);
const logger = pino({
  level: environment.LOG_LEVEL,
  redact: {
    paths: ["password", "token", "authorization", "cookie"],
    censor: "[REDACTED]",
  },
});

logger.info(workerHealth(), "RepairFlow worker started");

const pollTimer = setInterval(() => {
  logger.debug({ pollIntervalMs: environment.WORKER_POLL_INTERVAL_MS }, "Worker heartbeat");
}, environment.WORKER_POLL_INTERVAL_MS);

function shutdown(signal: NodeJS.Signals): void {
  clearInterval(pollTimer);
  logger.info({ signal }, "RepairFlow worker stopped");
  process.exitCode = 0;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
