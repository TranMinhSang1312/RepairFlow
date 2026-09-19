import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts", "src/**/*.spec.ts"],
    env: {
      DATABASE_URL: "postgresql://repairflow:repairflow@localhost:5432/repairflow?schema=public",
      ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
      REFRESH_COOKIE_NAME: "repairflow_refresh",
      LOG_LEVEL: "silent",
    },
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
