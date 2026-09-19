import { describe, expect, it } from "vitest";

import { parseApiEnvironment, parseWebEnvironment } from "./index.js";

describe("environment parsing", () => {
  it("applies safe local defaults", () => {
    const api = parseApiEnvironment({
      DATABASE_URL: "postgresql://localhost/repairflow",
      ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
    });
    const web = parseWebEnvironment({});

    expect(api.API_PORT).toBe(3001);
    expect(api.LOG_LEVEL).toBe("info");
    expect(api.OBJECT_STORAGE_BUCKET).toBe("repairflow-private");
    expect(web.NEXT_PUBLIC_API_URL).toBe("http://localhost:3001/api/v1");
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
      }),
    ).toThrow();
  });
});
