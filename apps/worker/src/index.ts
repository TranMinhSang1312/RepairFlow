import { parseWorkerEnvironment } from "@repairflow/config";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import { hostname } from "node:os";
import pino from "pino";

import { AiCapabilityRegistry } from "./ai/ai-capability-registry.js";
import { DeepSeekResponsesAiGateway } from "./ai/deepseek-responses-ai-gateway.js";
import { DeterministicFakeAiGateway } from "./ai/deterministic-fake-ai-gateway.js";
import type { AiGateway } from "./ai/ai-gateway.js";
import { AiOutboxHandler } from "./ai/ai-outbox-handler.js";
import { AiOutboxRepository } from "./ai/ai-outbox-repository.js";
import { AiPriceCalculator } from "./ai/ai-price-calculator.js";
import { CircuitBreaker } from "./ai/circuit-breaker.js";
import { createPrismaClient } from "./database.js";
import { CompositeOutboxProcessor } from "./outbox/composite-outbox-processor.js";
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
    paths: [
      "password",
      "token",
      "authorization",
      "cookie",
      "apiKey",
      "input",
      "inputReference",
      "output",
      "reviewedOutput",
      "prompt",
      "providerBody",
      "req.headers.authorization",
    ],
    censor: "[REDACTED]",
  },
});

const workerId = `${hostname()}:${process.pid}`;
const prisma = createPrismaClient(environment.DATABASE_URL);
const notificationRepository = new OutboxRepository(prisma);
const publicTokenSecret = environment.PUBLIC_TOKEN_SECRET ?? environment.ACCESS_TOKEN_SECRET;
if (!publicTokenSecret) throw new Error("WORKER_PUBLIC_TOKEN_SECRET_REQUIRED");
const resolver = new DatabaseNotificationMessageResolver(
  prisma,
  publicTokenSecret,
  environment.PUBLIC_WEB_URL,
);
const notificationProvider =
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
const notificationHandler = new NotificationOutboxHandler(
  notificationRepository,
  resolver,
  notificationProvider,
);
const notificationProcessor = new OutboxProcessor(
  notificationRepository,
  notificationHandler,
  logger,
  `${workerId}:notifications`,
  {
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
  },
);

const aiGateway: AiGateway =
  environment.AI_ENABLED && environment.AI_PROVIDER === "deepseek"
    ? new DeepSeekResponsesAiGateway({
        apiKey: environment.DEEPSEEK_API_KEY!,
        baseUrl: environment.DEEPSEEK_BASE_URL,
        model: environment.DEEPSEEK_MODEL,
      })
    : new DeterministicFakeAiGateway();
const aiRepository = new AiOutboxRepository(prisma);
const aiHandler = new AiOutboxHandler(
  prisma,
  aiGateway,
  new AiCapabilityRegistry(),
  new AiPriceCalculator({
    version: environment.AI_PRICE_TABLE_VERSION,
    provider: aiGateway.provider,
    model: aiGateway.model,
    inputPriceMicrousdPerMillionTokens:
      aiGateway.provider === "deepseek"
        ? BigInt(environment.DEEPSEEK_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS)
        : 0n,
    outputPriceMicrousdPerMillionTokens:
      aiGateway.provider === "deepseek"
        ? BigInt(environment.DEEPSEEK_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS)
        : 0n,
  }),
  new CircuitBreaker({
    provider: `${aiGateway.provider}/${aiGateway.model}`,
    failureThreshold: environment.AI_CIRCUIT_BREAKER_THRESHOLD,
    cooldownMs: environment.AI_CIRCUIT_BREAKER_COOLDOWN_MS,
  }),
  {
    globalEnabled: environment.AI_ENABLED,
    timeoutMs: environment.AI_TIMEOUT_MS,
    maxOutputBytes: environment.AI_MAX_OUTPUT_BYTES,
  },
);
const aiProcessor = new OutboxProcessor(aiRepository, aiHandler, logger, `${workerId}:ai`, {
  eventTypes: [],
  notificationChannels: [],
  batchSize: environment.AI_WORKER_BATCH_SIZE,
  leaseMs: environment.AI_WORKER_LEASE_MS,
  maxAttempts: environment.AI_WORKER_MAX_ATTEMPTS,
  retryBaseMs: environment.WORKER_RETRY_BASE_MS,
  retryMaxMs: environment.WORKER_RETRY_MAX_MS,
});
const processor = new CompositeOutboxProcessor([notificationProcessor, aiProcessor]);
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
