import { z } from "zod";

const nodeEnvironment = z.enum(["development", "test", "production"]);
const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

const apiEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironment.default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: logLevel.default("info"),
  DATABASE_URL: z.string().min(1),
});

const workerEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironment.default("development"),
  LOG_LEVEL: logLevel.default("info"),
  DATABASE_URL: z.string().min(1),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(5000),
});

const webEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironment.default("development"),
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:3001/api/v1"),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;
export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export function parseApiEnvironment(
  environment: Record<string, string | undefined>,
): ApiEnvironment {
  return apiEnvironmentSchema.parse(environment);
}

export function parseWorkerEnvironment(
  environment: Record<string, string | undefined>,
): WorkerEnvironment {
  return workerEnvironmentSchema.parse(environment);
}

export function parseWebEnvironment(
  environment: Record<string, string | undefined>,
): WebEnvironment {
  return webEnvironmentSchema.parse(environment);
}
