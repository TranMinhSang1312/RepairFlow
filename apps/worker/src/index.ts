import { parseWorkerEnvironment } from "@repairflow/config";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import { hostname } from "node:os";
import pino from "pino";

import { createPrismaClient } from "./database.js";
import { DeterministicFakeNotificationProvider } from "./outbox/notification-provider.js";
import { NotificationOutboxHandler } from "./outbox/notification-outbox-handler.js";
import { OutboxLoop } from "./outbox/outbox-loop.js";
import { OutboxProcessor } from "./outbox/outbox-processor.js";
import { OutboxRepository } from "./outbox/outbox-repository.js";
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

const workerId = `${hostname()}:${process.pid}`;
if (environment.WORKER_NOTIFICATION_PROVIDER !== "fake") {
  throw new Error("WORKER_NOTIFICATION_PROVIDER_NOT_IMPLEMENTED");
}
const prisma = createPrismaClient(environment.DATABASE_URL);
const repository = new OutboxRepository(prisma);
const provider = new DeterministicFakeNotificationProvider();
const handler = new NotificationOutboxHandler(repository, provider);
const processor = new OutboxProcessor(repository, handler, logger, workerId, {
  eventTypes: ["QUOTE_SENT"],
  batchSize: environment.WORKER_BATCH_SIZE,
  leaseMs: environment.WORKER_LEASE_MS,
  maxAttempts: environment.WORKER_MAX_ATTEMPTS,
  retryBaseMs: environment.WORKER_RETRY_BASE_MS,
  retryMaxMs: environment.WORKER_RETRY_MAX_MS,
});
const loop = new OutboxLoop(processor, logger, environment.WORKER_POLL_INTERVAL_MS);
let shuttingDown = false;

logger.info({ ...workerHealth(), workerId }, "RepairFlow worker started");
loop.start();

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await loop.stop();
  await prisma.$disconnect();
  logger.info({ signal, workerId }, "RepairFlow worker stopped");
}

process.once("SIGINT", (signal) => void shutdown(signal));
process.once("SIGTERM", (signal) => void shutdown(signal));
