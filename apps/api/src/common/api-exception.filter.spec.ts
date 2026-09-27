import type { ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { ErrorTracker } from "../observability/error-tracker.js";
import { ApiExceptionFilter } from "./api-exception.filter.js";

describe("ApiExceptionFilter structured error tracking", () => {
  it("captures only safe 5xx dimensions", () => {
    const capture = vi.fn<ErrorTracker["capture"]>();
    const response = {
      getHeader: vi.fn().mockReturnValue("request-safe"),
      setHeader: vi.fn(),
      status: vi.fn(),
      json: vi.fn(),
    };
    response.status.mockReturnValue(response);
    const request = {
      id: "request-safe",
      method: "POST",
      route: { path: "/quotes/:id/send" },
      body: { token: "raw-token-secret" },
      headers: { authorization: "Bearer access-secret" },
      query: { destination: "recipient@example.test" },
    };
    const host = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ArgumentsHost;

    new ApiExceptionFilter({ capture }).catch(
      new Error("provider response body contains provider-secret"),
      host,
    );

    expect(capture).toHaveBeenCalledWith({
      event: "api.request.error",
      service: "api",
      requestId: "request-safe",
      method: "POST",
      route: "/quotes/:id/send",
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
    });
    const serialized = JSON.stringify(capture.mock.calls);
    for (const secret of [
      "raw-token-secret",
      "access-secret",
      "recipient@example.test",
      "provider-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId: "request-safe",
      },
    });
  });
});
