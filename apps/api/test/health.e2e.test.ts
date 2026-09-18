import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/application.js";

describe("health endpoint", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns health and propagates a request id", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health")
      .set("X-Request-Id", "test-request-id")
      .expect(200);

    expect(response.headers["x-request-id"]).toBe("test-request-id");
    expect(response.body).toMatchObject({ service: "api", status: "ok", version: "0.1.0" });
  });
});
