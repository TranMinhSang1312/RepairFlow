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
  eventTypes: ["QUOTE_SENT"],
  notificationChannels: ["EMAIL"],
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
