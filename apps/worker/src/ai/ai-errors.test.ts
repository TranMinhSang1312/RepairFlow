import { describe, expect, it } from "vitest";
import { AiGatewayError, isAiGatewayError } from "./ai-errors.js";

describe("AiGatewayError", () => {
  it("exposes only stable normalized metadata", () => {
    const error = new AiGatewayError("AI_PROVIDER_UNAVAILABLE", {
      provider: "deepseek",
      model: "deepseek-flash",
      outcome: "UNKNOWN",
      retryDisposition: "AMBIGUOUS_AFTER_DISPATCH",
      statusCode: 503,
      usage: { inputTokens: 12, outputTokens: 4 },
    });

    expect(error.message).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(error).toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      provider: "deepseek",
      model: "deepseek-flash",
      outcome: "UNKNOWN",
      retryDisposition: "AMBIGUOUS_AFTER_DISPATCH",
      statusCode: 503,
      usage: { inputTokens: 12, outputTokens: 4 },
    });
    expect(isAiGatewayError(error)).toBe(true);
    expect(isAiGatewayError(new Error("AI_PROVIDER_UNAVAILABLE"))).toBe(false);
  });
});
