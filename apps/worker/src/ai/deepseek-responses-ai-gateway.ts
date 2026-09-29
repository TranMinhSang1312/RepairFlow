import { AiGatewayError, isAiGatewayError } from "./ai-errors.js";
import type { AiGateway, AiGatewayRequest, AiGatewayResult } from "./ai-gateway.js";
import type { CircuitBreaker, CircuitBreakerPermit } from "./circuit-breaker.js";

export interface DeepSeekResponsesAiGatewayOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  circuitBreaker?: CircuitBreaker;
  fetchImplementation?: typeof fetch;
  now?: () => number;
}

export class DeepSeekResponsesAiGateway implements AiGateway {
  readonly provider = "deepseek";
  readonly model: string;
  private readonly endpoint: URL;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: DeepSeekResponsesAiGatewayOptions) {
    if (!options.apiKey.trim()) throw new RangeError("DeepSeek API key is required");
    if (!options.model.trim()) throw new RangeError("DeepSeek model is required");
    this.model = options.model;
    this.endpoint = buildResponsesEndpoint(options.baseUrl);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => performance.now());
  }

  async generate(request: AiGatewayRequest): Promise<AiGatewayResult> {
    validateRequestLimits(request);
    const permit = this.options.circuitBreaker?.acquire();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    const startedAt = this.now();

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildProviderRequest(this.options.model, request)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = classifyHttpFailure(response.status, this.model);
        settleCircuitForError(permit, error);
        throw error;
      }

      const body = await readJsonBodyWithLimit(response, request.maxOutputBytes, this.model);
      const normalized = normalizeResponse(body, this.model, Math.max(0, this.now() - startedAt));
      permit?.success();
      return normalized;
    } catch (error) {
      if (isAiGatewayError(error)) {
        // HTTP failures are settled before they are thrown. Other gateway failures reach here first.
        if (error.statusCode === undefined) settleCircuitForError(permit, error);
        throw error;
      }

      const mapped = controller.signal.aborted
        ? new AiGatewayError("AI_PROVIDER_TIMEOUT", {
            provider: "deepseek",
            model: this.model,
            outcome: "UNKNOWN",
            retryDisposition: "AMBIGUOUS_AFTER_DISPATCH",
          })
        : new AiGatewayError("AI_PROVIDER_UNAVAILABLE", {
            provider: "deepseek",
            model: this.model,
            outcome: "UNKNOWN",
            retryDisposition: "AMBIGUOUS_AFTER_DISPATCH",
          });
      settleCircuitForError(permit, mapped);
      throw mapped;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildResponsesEndpoint(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new RangeError("DeepSeek base URL is invalid");
  }
  if (url.protocol !== "https:") throw new RangeError("DeepSeek base URL must use HTTPS");
  if (url.username || url.password)
    throw new RangeError("DeepSeek base URL cannot contain credentials");
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/responses`;
  url.search = "";
  url.hash = "";
  return url;
}

function validateRequestLimits(request: AiGatewayRequest): void {
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1) {
    throw new RangeError("AI timeout must be a positive integer");
  }
  if (!Number.isInteger(request.maxOutputBytes) || request.maxOutputBytes < 1) {
    throw new RangeError("AI max output bytes must be a positive integer");
  }
  if ((request.images?.length ?? 0) > 1) {
    throw new RangeError("AI image count exceeds the device OCR limit");
  }
  for (const image of request.images ?? []) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(image.mediaType) ||
      image.base64Data.length < 1 ||
      image.base64Data.length > 20_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(image.base64Data)
    ) {
      throw new RangeError("AI image input is invalid or too large");
    }
  }
}

function buildProviderRequest(model: string, request: AiGatewayRequest): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: JSON.stringify({
        capability: request.capability,
        promptVersion: request.promptVersion,
        schemaVersion: request.schemaVersion,
        input: request.input,
      }),
    },
  ];

  for (const image of request.images ?? []) {
    content.push({
      type: "input_image",
      image_url: `data:${image.mediaType};base64,${image.base64Data}`,
    });
  }

  return {
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: request.systemPrompt }] },
      { role: "user", content },
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName(request.capability, request.schemaVersion),
        schema: request.outputSchema,
      },
    },
    max_output_tokens: Math.max(1, Math.min(16_384, Math.floor(request.maxOutputBytes / 4))),
    stream: false,
  };
}

function schemaName(capability: string, version: string): string {
  const normalized = `${capability}_${version}`.toLowerCase().replace(/[^a-z0-9_-]/gu, "_");
  return normalized.slice(0, 64) || "repairflow_ai_output";
}

function classifyHttpFailure(statusCode: number, model: string): AiGatewayError {
  if (statusCode === 429) {
    return new AiGatewayError("AI_PROVIDER_RATE_LIMITED", {
      provider: "deepseek",
      model,
      outcome: "NOT_STARTED",
      retryDisposition: "SAFE_BEFORE_INFERENCE",
      statusCode,
    });
  }
  if (statusCode === 408 || statusCode === 425 || statusCode >= 500) {
    return new AiGatewayError("AI_PROVIDER_UNAVAILABLE", {
      provider: "deepseek",
      model,
      outcome: "UNKNOWN",
      retryDisposition: "AMBIGUOUS_AFTER_DISPATCH",
      statusCode,
    });
  }
  return new AiGatewayError("AI_PROVIDER_REJECTED", {
    provider: "deepseek",
    model,
    outcome: "NOT_STARTED",
    retryDisposition: "NOT_RETRYABLE",
    statusCode,
  });
}

async function readJsonBodyWithLimit(
  response: Response,
  maxBytes: number,
  model: string,
): Promise<unknown> {
  if (!response.body) {
    throw invalidResponse(model);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new AiGatewayError("AI_PROVIDER_RESPONSE_TOO_LARGE", {
          provider: "deepseek",
          model,
          outcome: "UNKNOWN",
        });
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (isAiGatewayError(error)) throw error;
    throw invalidResponse(model);
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidResponse(model);
  }
}

function normalizeResponse(
  body: unknown,
  configuredModel: string,
  latencyMs: number,
): AiGatewayResult {
  if (!isRecord(body)) throw invalidResponse(configuredModel);
  if (body.status !== "completed") throw invalidResponse(configuredModel);

  const usage = readUsage(body.usage, configuredModel);
  const outputText = extractOutputText(body);
  if (outputText === undefined) throw invalidResponse(configuredModel, usage);
  let output: unknown;
  try {
    output = JSON.parse(outputText) as unknown;
  } catch {
    throw invalidResponse(configuredModel, usage);
  }

  return {
    provider: "deepseek",
    // Keep the configured billing alias stable even if the provider reports a dated backend.
    model: configuredModel,
    output,
    usage,
    latencyMs: Math.round(latencyMs),
  };
}

function extractOutputText(body: Record<string, unknown>): string | undefined {
  if (typeof body.output_text === "string") return body.output_text;
  if (!Array.isArray(body.output)) return undefined;

  const parts: string[] = [];
  for (const item of body.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.length === 0 ? undefined : parts.join("");
}

function readUsage(value: unknown, model: string): { inputTokens: number; outputTokens: number } {
  if (!isRecord(value)) throw invalidResponse(model);
  const inputTokens = readTokenCount(value.input_tokens);
  const outputTokens = readTokenCount(value.output_tokens);
  if (inputTokens === undefined || outputTokens === undefined) throw invalidResponse(model);
  return { inputTokens, outputTokens };
}

function readTokenCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(
  model: string,
  usage?: { inputTokens: number; outputTokens: number },
): AiGatewayError {
  return new AiGatewayError("AI_PROVIDER_INVALID_RESPONSE", {
    provider: "deepseek",
    model,
    outcome: "UNKNOWN",
    retryDisposition: "NOT_RETRYABLE",
    ...(usage ? { usage } : {}),
  });
}

function settleCircuitForError(
  permit: CircuitBreakerPermit | undefined,
  error: AiGatewayError,
): void {
  if (!permit) return;
  if (
    error.code === "AI_PROVIDER_TIMEOUT" ||
    error.code === "AI_PROVIDER_UNAVAILABLE" ||
    error.code === "AI_PROVIDER_RESPONSE_TOO_LARGE" ||
    error.code === "AI_PROVIDER_INVALID_RESPONSE"
  ) {
    permit.failure();
  } else {
    // A clear provider response proves availability even when the request was rejected/rate-limited.
    permit.success();
  }
}
