import { describe, expect, it } from "vitest";

import { parseApiEnvironment, parseWebEnvironment, parseWorkerEnvironment } from "./index.js";

describe("environment parsing", () => {
  it("applies safe local defaults", () => {
    const api = parseApiEnvironment({
      DATABASE_URL: "postgresql://localhost/repairflow",
      ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
    });
    const web = parseWebEnvironment({});
    const worker = parseWorkerEnvironment({
      DATABASE_URL: "postgresql://localhost/repairflow",
      ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
    });

    expect(api.API_PORT).toBe(3001);
    expect(api.LOG_LEVEL).toBe("info");
    expect(api.OBJECT_STORAGE_BUCKET).toBe("repairflow-private");
    expect(api.PUBLIC_WEB_URL).toBe("http://localhost:3000");
    expect(api.AI_ENABLED).toBe(false);
    expect(web.NEXT_PUBLIC_API_URL).toBe("http://localhost:3001/api/v1");
    expect(worker).toMatchObject({
      WORKER_BATCH_SIZE: 10,
      WORKER_LEASE_MS: 30000,
      WORKER_MAX_ATTEMPTS: 5,
      WORKER_RETRY_BASE_MS: 1000,
      WORKER_RETRY_MAX_MS: 60000,
      WORKER_HEALTH_HOST: "0.0.0.0",
      WORKER_HEALTH_PORT: 3002,
      WORKER_READINESS_STALE_MS: 30000,
      WORKER_ALERT_FAILURE_THRESHOLD: 3,
      WORKER_ALERT_DEAD_LETTER_THRESHOLD: 1,
      WORKER_NOTIFICATION_PROVIDER: "fake",
      AI_ENABLED: false,
      AI_PROVIDER: "fake",
      AI_TIMEOUT_MS: 15000,
      AI_MAX_OUTPUT_BYTES: 65536,
      AI_CIRCUIT_BREAKER_THRESHOLD: 5,
      AI_CIRCUIT_BREAKER_COOLDOWN_MS: 30000,
      AI_WORKER_BATCH_SIZE: 2,
      AI_WORKER_LEASE_MS: 120000,
      AI_WORKER_MAX_ATTEMPTS: 2,
    });
  });

  it("rejects invalid worker retry boundaries", () => {
    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: "postgresql://localhost/repairflow",
        ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
        WORKER_MAX_ATTEMPTS: "0",
      }),
    ).toThrow();
    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: "postgresql://localhost/repairflow",
        ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
        WORKER_POLL_INTERVAL_MS: "5000",
        WORKER_READINESS_STALE_MS: "9000",
      }),
    ).toThrow();
  });

  it("rejects the deterministic notification provider in production", () => {
    expect(() =>
      parseWorkerEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/repairflow",
        PUBLIC_TOKEN_SECRET: "production-public-token-secret-at-least-32-chars",
      }),
    ).toThrow();
    expect(
      parseWorkerEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/repairflow",
        PUBLIC_TOKEN_SECRET: "production-public-token-secret-at-least-32-chars",
        RESEND_API_KEY: "resend-test-key",
        RESEND_FROM_EMAIL: "RepairFlow <notify@example.test>",
        WORKER_NOTIFICATION_PROVIDER: "email",
      }).WORKER_NOTIFICATION_PROVIDER,
    ).toBe("email");
  });

  it("requires token derivation and email provider credentials", () => {
    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: "postgresql://localhost/repairflow",
      }),
    ).toThrow();
    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: "postgresql://localhost/repairflow",
        ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
        WORKER_NOTIFICATION_PROVIDER: "email",
      }),
    ).toThrow();
    expect(
      parseWorkerEnvironment({
        DATABASE_URL: "postgresql://localhost/repairflow",
        ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
        WORKER_NOTIFICATION_PROVIDER: "email",
        RESEND_API_KEY: "resend-test-key",
        RESEND_FROM_EMAIL: "RepairFlow <notify@example.test>",
      }).RESEND_TIMEOUT_MS,
    ).toBe(10000);
  });

  it("validates enabled DeepSeek configuration without exposing the secret", () => {
    const valid = parseWorkerEnvironment({
      DATABASE_URL: "postgresql://localhost/repairflow",
      ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
      AI_ENABLED: "true",
      AI_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "deepseek-secret-canary",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
      DEEPSEEK_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS: "100000",
      DEEPSEEK_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS: "200000",
      AI_PRICE_TABLE_VERSION: "test-v1",
    });
    expect(valid.AI_ENABLED).toBe(true);
    expect(valid.AI_PROVIDER).toBe("deepseek");

    for (const invalid of [
      {
        DEEPSEEK_BASE_URL: "http://api.deepseek.test",
        DEEPSEEK_API_KEY: "deepseek-secret-canary",
        DEEPSEEK_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS: "100000",
        DEEPSEEK_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS: "200000",
      },
      {
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
        DEEPSEEK_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS: "100000",
        DEEPSEEK_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS: "200000",
      },
      {
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
        DEEPSEEK_API_KEY: "deepseek-secret-canary",
        DEEPSEEK_INPUT_PRICE_MICROUSD_PER_MILLION_TOKENS: "0",
        DEEPSEEK_OUTPUT_PRICE_MICROUSD_PER_MILLION_TOKENS: "0",
      },
    ]) {
      expect(() =>
        parseWorkerEnvironment({
          DATABASE_URL: "postgresql://localhost/repairflow",
          ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
          AI_ENABLED: "true",
          AI_PROVIDER: "deepseek",
          ...invalid,
        }),
      ).toThrowError(expect.not.stringContaining("deepseek-secret-canary"));
    }
  });

  it("does not allow enabled fake AI in production", () => {
    expect(() =>
      parseWorkerEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/repairflow",
        PUBLIC_TOKEN_SECRET: "production-public-token-secret-at-least-32-chars",
        WORKER_NOTIFICATION_PROVIDER: "email",
        RESEND_API_KEY: "resend-test-key",
        RESEND_FROM_EMAIL: "RepairFlow <notify@example.test>",
        AI_ENABLED: "true",
        AI_PROVIDER: "fake",
      }),
    ).toThrow();
  });

  it("requires the AI lease to outlive provider timeout", () => {
    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: "postgresql://localhost/repairflow",
        ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
        AI_TIMEOUT_MS: "15000",
        AI_WORKER_LEASE_MS: "19000",
      }),
    ).toThrow();
  });

  it("rejects a missing database URL", () => {
    expect(() =>
      parseApiEnvironment({
        ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
      }),
    ).toThrow();
  });

  it("rejects a short access-token secret", () => {
    expect(() =>
      parseApiEnvironment({
        DATABASE_URL: "postgresql://localhost/repairflow",
        ACCESS_TOKEN_SECRET: "too-short",
      }),
    ).toThrow();
  });

  it("rejects the documented placeholder secret in production", () => {
    expect(() =>
      parseApiEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/repairflow",
        ACCESS_TOKEN_SECRET: "replace-with-at-least-32-random-characters",
      }),
    ).toThrow();
  });

  it("rejects local object-storage credentials in production", () => {
    expect(() =>
      parseApiEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/repairflow",
        ACCESS_TOKEN_SECRET: "production-secret-that-is-at-least-32-characters",
        PUBLIC_TOKEN_SECRET: "separate-production-public-token-secret-value",
      }),
    ).toThrow();
  });

  it("requires a dedicated public-token secret in production", () => {
    expect(() =>
      parseApiEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/repairflow",
        ACCESS_TOKEN_SECRET: "production-secret-that-is-at-least-32-characters",
        OBJECT_STORAGE_SECRET_KEY: "production-object-storage-secret",
      }),
    ).toThrow();
    expect(() =>
      parseApiEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/repairflow",
        ACCESS_TOKEN_SECRET: "production-secret-that-is-at-least-32-characters",
        PUBLIC_TOKEN_SECRET: "replace-with-a-different-32-byte-random-secret",
        OBJECT_STORAGE_SECRET_KEY: "production-object-storage-secret",
      }),
    ).toThrow();
  });
});
