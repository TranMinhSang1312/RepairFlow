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
    });

    expect(api.API_PORT).toBe(3001);
    expect(api.LOG_LEVEL).toBe("info");
    expect(api.OBJECT_STORAGE_BUCKET).toBe("repairflow-private");
    expect(api.PUBLIC_WEB_URL).toBe("http://localhost:3000");
    expect(web.NEXT_PUBLIC_API_URL).toBe("http://localhost:3001/api/v1");
    expect(worker).toMatchObject({
      WORKER_BATCH_SIZE: 10,
      WORKER_LEASE_MS: 30000,
      WORKER_MAX_ATTEMPTS: 5,
      WORKER_RETRY_BASE_MS: 1000,
      WORKER_RETRY_MAX_MS: 60000,
      WORKER_NOTIFICATION_PROVIDER: "fake",
    });
  });

  it("rejects invalid worker retry boundaries", () => {
    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: "postgresql://localhost/repairflow",
        WORKER_MAX_ATTEMPTS: "0",
      }),
    ).toThrow();
  });

  it("rejects the deterministic notification provider in production", () => {
    expect(() =>
      parseWorkerEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/repairflow",
      }),
    ).toThrow();
    expect(
      parseWorkerEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/repairflow",
        WORKER_NOTIFICATION_PROVIDER: "email",
      }).WORKER_NOTIFICATION_PROVIDER,
    ).toBe("email");
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
