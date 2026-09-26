import { z } from "zod";

const nodeEnvironment = z.enum(["development", "test", "production"]);
const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

const apiEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvironment.default("development"),
    API_HOST: z.string().default("0.0.0.0"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: logLevel.default("info"),
    DATABASE_URL: z.string().min(1),
    ACCESS_TOKEN_SECRET: z.string().min(32),
    PUBLIC_TOKEN_SECRET: z.string().min(32).optional(),
    PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),
    REFRESH_COOKIE_NAME: z.string().min(1).default("repairflow_refresh"),
    OBJECT_STORAGE_ENDPOINT: z.string().url().default("http://localhost:9000"),
    OBJECT_STORAGE_REGION: z.string().min(1).default("us-east-1"),
    OBJECT_STORAGE_BUCKET: z.string().min(1).default("repairflow-private"),
    OBJECT_STORAGE_ACCESS_KEY: z.string().min(1).default("repairflow"),
    OBJECT_STORAGE_SECRET_KEY: z.string().min(8).default("local-development-only"),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      environment.ACCESS_TOKEN_SECRET.startsWith("replace-with-")
    ) {
      context.addIssue({
        code: "custom",
        path: ["ACCESS_TOKEN_SECRET"],
        message: "Production requires a non-placeholder access-token secret.",
      });
    }
    if (
      environment.NODE_ENV === "production" &&
      (!environment.PUBLIC_TOKEN_SECRET ||
        environment.PUBLIC_TOKEN_SECRET.startsWith("replace-with-"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["PUBLIC_TOKEN_SECRET"],
        message: "Production requires a dedicated non-placeholder public-token derivation secret.",
      });
    }
    if (
      environment.NODE_ENV === "production" &&
      environment.OBJECT_STORAGE_SECRET_KEY === "local-development-only"
    ) {
      context.addIssue({
        code: "custom",
        path: ["OBJECT_STORAGE_SECRET_KEY"],
        message: "Production requires a non-default object-storage secret.",
      });
    }
  });

const workerEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvironment.default("development"),
    LOG_LEVEL: logLevel.default("info"),
    DATABASE_URL: z.string().min(1),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(5000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    WORKER_LEASE_MS: z.coerce.number().int().min(1000).max(900000).default(30000),
    WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(25).default(5),
    WORKER_RETRY_BASE_MS: z.coerce.number().int().min(250).max(3600000).default(1000),
    WORKER_RETRY_MAX_MS: z.coerce.number().int().min(250).max(86400000).default(60000),
    WORKER_NOTIFICATION_PROVIDER: z.enum(["fake", "email"]).default("fake"),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      environment.WORKER_NOTIFICATION_PROVIDER === "fake"
    ) {
      context.addIssue({
        code: "custom",
        path: ["WORKER_NOTIFICATION_PROVIDER"],
        message:
          "Production cannot mark notifications sent through the deterministic fake provider.",
      });
    }
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
