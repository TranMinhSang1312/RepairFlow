import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.spec.ts"],
    env: {
      DATABASE_URL: "postgresql://repairflow:repairflow@localhost:5432/repairflow?schema=public",
      LOG_LEVEL: "silent",
    },
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
