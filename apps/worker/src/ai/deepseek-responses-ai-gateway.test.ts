import { AI_OUTPUT_SCHEMAS } from "@repairflow/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiGatewayRequest } from "./ai-gateway.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { DeepSeekResponsesAiGateway } from "./deepseek-responses-ai-gateway.js";

const API_KEY_CANARY = "secret-api-key-that-must-never-leak";

describe("DeepSeekResponsesAiGateway", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes a Responses API result and sends structured output without provider types escaping", async () => {
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
        void _input;
        void _init;
        return jsonResponse({
          model: "deepseek-flash-202609",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    summary: "Thiết bị đang được kiểm tra.",
                    claimsUsed: [],
                    warnings: [],
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 120, output_tokens: 32, total_tokens: 152 },
        });
      },
    );
    const fetchImplementation = fetchMock as unknown as typeof fetch;
    const clock = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(112.4);
    const gateway = createGateway(fetchImplementation, { now: clock });

    const result = await gateway.generate({
      ...request(),
      images: [{ mediaType: "image/png", base64Data: "c2FmZS1pbWFnZQ==" }],
    });

    expect(result).toEqual({
      provider: "deepseek",
      model: "deepseek-flash",
      output: { summary: "Thiết bị đang được kiểm tra.", claimsUsed: [], warnings: [] },
      usage: { inputTokens: 120, outputTokens: 32 },
      latencyMs: 12,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.deepseek.com/v1/responses");
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY_CANARY}`,
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "deepseek-flash",
      max_output_tokens: 16384,
      stream: false,
      text: { format: { type: "json_schema", name: "customer_summary_v1" } },
    });
    expect(JSON.stringify(body)).toContain("data:image/png;base64,c2FmZS1pbWFnZQ==");
    expect(JSON.stringify(result)).not.toContain(API_KEY_CANARY);
  });

  it("supports the top-level output_text response convenience field", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({
        model: "deepseek-flash",
        output_text: '{"summary":"Safe","claimsUsed":[],"warnings":[]}',
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    ) as unknown as typeof fetch;
    const result = await createGateway(fetchImplementation).generate(request());
    expect(result.output).toEqual({ summary: "Safe", claimsUsed: [], warnings: [] });
  });

  it("aborts on timeout and reports an unknown billable outcome without leaking errors", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error(`leak:${API_KEY_CANARY}`)),
          );
        }),
    ) as unknown as typeof fetch;
    const gateway = createGateway(fetchImplementation);
    const generated = gateway.generate({ ...request(), timeoutMs: 20 });
    const assertion = expect(generated).rejects.toMatchObject({
      code: "AI_PROVIDER_TIMEOUT",
      provider: "deepseek",
      model: "deepseek-flash",
      outcome: "UNKNOWN",
      retryDisposition: "AMBIGUOUS_AFTER_DISPATCH",
      message: "AI_PROVIDER_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
  });

  it.each([
    [429, "AI_PROVIDER_RATE_LIMITED", "NOT_STARTED", "SAFE_BEFORE_INFERENCE"],
    [503, "AI_PROVIDER_UNAVAILABLE", "UNKNOWN", "AMBIGUOUS_AFTER_DISPATCH"],
    [401, "AI_PROVIDER_REJECTED", "NOT_STARTED", "NOT_RETRYABLE"],
  ] as const)(
    "classifies HTTP %i without exposing the provider body",
    async (status, code, outcome, retry) => {
      const fetchImplementation = vi.fn(
        async () => new Response(`provider-body:${API_KEY_CANARY}`, { status }),
      ) as unknown as typeof fetch;
      const generated = createGateway(fetchImplementation).generate(request());
      await expect(generated).rejects.toMatchObject({
        code,
        provider: "deepseek",
        model: "deepseek-flash",
        outcome,
        retryDisposition: retry,
        statusCode: status,
        message: code,
      });
      await expect(
        generated.catch((error: unknown) => JSON.stringify(error)),
      ).resolves.not.toContain(API_KEY_CANARY);
    },
  );

  it("preserves normalized usage when the generated JSON is invalid", async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse({
        model: "deepseek-flash",
        output_text: "not-json",
        usage: { input_tokens: 9, output_tokens: 3 },
      }),
    ) as unknown as typeof fetch;
    await expect(createGateway(fetchImplementation).generate(request())).rejects.toMatchObject({
      code: "AI_PROVIDER_INVALID_RESPONSE",
      outcome: "UNKNOWN",
      usage: { inputTokens: 9, outputTokens: 3 },
    });
  });

  it("rejects an incomplete HTTP 200 response instead of persisting a partial draft", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "incomplete",
            model: "deepseek-flash",
            output_text: '{"summary":"Partial"}',
            usage: { input_tokens: 9, output_tokens: 3 },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    await expect(createGateway(fetchImplementation).generate(request())).rejects.toMatchObject({
      code: "AI_PROVIDER_INVALID_RESPONSE",
      outcome: "UNKNOWN",
    });
  });

  it("stops reading an oversized provider response", async () => {
    const fetchImplementation = vi.fn(
      async () => new Response("x".repeat(100), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(
      createGateway(fetchImplementation).generate({ ...request(), maxOutputBytes: 50 }),
    ).rejects.toMatchObject({
      code: "AI_PROVIDER_RESPONSE_TOO_LARGE",
      outcome: "UNKNOWN",
    });
  });

  it("rejects unbounded or malformed image input before the provider request", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const gateway = createGateway(fetchImplementation);
    await expect(
      gateway.generate({
        ...request(),
        images: [{ mediaType: "image/png", base64Data: "not base64***" }],
      }),
    ).rejects.toThrow("image input");
    await expect(
      gateway.generate({
        ...request(),
        images: [
          { mediaType: "image/png", base64Data: "YQ==" },
          { mediaType: "image/jpeg", base64Data: "Yg==" },
        ],
      }),
    ).rejects.toThrow("image count");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("maps network errors to a sanitized unknown-outcome error", async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error(`socket failed ${API_KEY_CANARY}`);
    }) as unknown as typeof fetch;
    const generated = createGateway(fetchImplementation).generate(request());
    await expect(generated).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      outcome: "UNKNOWN",
      message: "AI_PROVIDER_UNAVAILABLE",
    });
  });

  it("opens the circuit and prevents a second provider call", async () => {
    const breaker = new CircuitBreaker({
      provider: "deepseek/deepseek-flash",
      failureThreshold: 1,
      cooldownMs: 10_000,
    });
    const fetchImplementation = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const gateway = createGateway(fetchImplementation, { circuitBreaker: breaker });
    await expect(gateway.generate(request())).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
    await expect(gateway.generate(request())).rejects.toMatchObject({
      code: "AI_PROVIDER_CIRCUIT_OPEN",
      outcome: "NOT_STARTED",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe adapter configuration before any call", () => {
    expect(
      () =>
        new DeepSeekResponsesAiGateway({
          apiKey: "",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-flash",
        }),
    ).toThrow("API key");
    expect(
      () =>
        new DeepSeekResponsesAiGateway({
          apiKey: "secret",
          baseUrl: "http://api.deepseek.com",
          model: "deepseek-flash",
        }),
    ).toThrow("HTTPS");
    expect(
      () =>
        new DeepSeekResponsesAiGateway({
          apiKey: "secret",
          baseUrl: "https://user:password@api.deepseek.com",
          model: "deepseek-flash",
        }),
    ).toThrow("credentials");
  });
});

function createGateway(
  fetchImplementation: typeof fetch,
  overrides: Partial<
    Pick<ConstructorParameters<typeof DeepSeekResponsesAiGateway>[0], "now" | "circuitBreaker">
  > = {},
): DeepSeekResponsesAiGateway {
  return new DeepSeekResponsesAiGateway({
    apiKey: API_KEY_CANARY,
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    fetchImplementation,
    ...overrides,
  });
}

function request(): AiGatewayRequest {
  return {
    capability: "CUSTOMER_SUMMARY",
    promptVersion: "v1",
    schemaVersion: "v1",
    systemPrompt: "Return only the schema.",
    input: { approvedFactIds: ["fact-1"] },
    outputSchema: AI_OUTPUT_SCHEMAS.CUSTOMER_SUMMARY,
    timeoutMs: 1_000,
    maxOutputBytes: 65_536,
  };
}

function jsonResponse(body: unknown): Response {
  const responseBody =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? { status: "completed", ...body }
      : body;
  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
