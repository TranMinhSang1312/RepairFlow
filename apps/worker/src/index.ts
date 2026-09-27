import { parseWorkerEnvironment } from "@repairflow/config";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import { hostname } from "node:os";
import pino from "pino";

import { createPrismaClient } from "./database.js";
import { DatabaseNotificationMessageResolver } from "./outbox/notification-message-resolver.js";
import { DeterministicFakeNotificationProvider } from "./outbox/notification-provider.js";
import { NotificationOutboxHandler } from "./outbox/notification-outbox-handler.js";
import { OutboxLoop } from "./outbox/outbox-loop.js";
import { OutboxProcessor } from "./outbox/outbox-processor.js";
import { OutboxRepository } from "./outbox/outbox-repository.js";
import { ResendEmailNotificationProvider } from "./outbox/resend-email.provider.js";
import { WorkerMetrics } from "./observability/worker-metrics.js";
import { WorkerOperationsServer } from "./observability/worker-operations-server.js";
import { WorkerReadiness } from "./observability/worker-readiness.js";
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
const prisma = createPrismaClient(environment.DATABASE_URL);
const repository = new OutboxRepository(prisma);
const publicTokenSecret = environment.PUBLIC_TOKEN_SECRET ?? environment.ACCESS_TOKEN_SECRET;
if (!publicTokenSecret) throw new Error("WORKER_PUBLIC_TOKEN_SECRET_REQUIRED");
const resolver = new DatabaseNotificationMessageResolver(
  prisma,
  publicTokenSecret,
  environment.PUBLIC_WEB_URL,
);
const provider =
  environment.WORKER_NOTIFICATION_PROVIDER === "fake"
    ? new DeterministicFakeNotificationProvider()
    : new ResendEmailNotificationProvider({
        apiUrl: environment.RESEND_API_URL,
        apiKey: environment.RESEND_API_KEY!,
        from: environment.RESEND_FROM_EMAIL!,
        ...(environment.RESEND_REPLY_TO_EMAIL
          ? { replyTo: environment.RESEND_REPLY_TO_EMAIL }
          : {}),
        timeoutMs: environment.RESEND_TIMEOUT_MS,
      });
const handler = new NotificationOutboxHandler(repository, resolver, provider);
const processor = new OutboxProcessor(repository, handler, logger, workerId, {
  eventTypes: [
    "QUOTE_SENT",
    "REPAIR_ORDER_READY",
    "REPAIR_ORDER_COMPLETED",
    "STAFF_INVITATION_CREATED",
  ],
  notificationChannels: ["EMAIL"],
  batchSize: environment.WORKER_BATCH_SIZE,
  leaseMs: environment.WORKER_LEASE_MS,
  maxAttempts: environment.WORKER_MAX_ATTEMPTS,
  retryBaseMs: environment.WORKER_RETRY_BASE_MS,
  retryMaxMs: environment.WORKER_RETRY_MAX_MS,
});
const metrics = new WorkerMetrics(
  logger,
  environment.WORKER_ALERT_FAILURE_THRESHOLD,
  environment.WORKER_ALERT_DEAD_LETTER_THRESHOLD,
);
const loop = new OutboxLoop(processor, logger, environment.WORKER_POLL_INTERVAL_MS, metrics);
const readiness = new WorkerReadiness(
  async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  metrics,
  environment.WORKER_READINESS_STALE_MS,
);
const operationsServer = new WorkerOperationsServer(
  environment.WORKER_HEALTH_HOST,
  environment.WORKER_HEALTH_PORT,
  readiness,
  metrics,
);
let shuttingDown = false;

async function bootstrap(): Promise<void> {
  await operationsServer.start();
  logger.info(
    {
      ...workerHealth(),
      workerId,
      healthPort: environment.WORKER_HEALTH_PORT,
    },
    "RepairFlow worker started",
  );
  loop.start();
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await loop.stop();
  await operationsServer.stop();
  await prisma.$disconnect();
  logger.info({ signal, workerId }, "RepairFlow worker stopped");
}

process.once("SIGINT", (signal) => void shutdown(signal));
process.once("SIGTERM", (signal) => void shutdown(signal));
void bootstrap().catch(async () => {
  logger.fatal(
    { event: "worker.bootstrap.error", service: "worker", errorCode: "WORKER_BOOTSTRAP_FAILED" },
    "RepairFlow worker failed to start",
  );
  await prisma.$disconnect();
  process.exitCode = 1;
});
