export const AI_GATEWAY_ERROR_CODES = [
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_RATE_LIMITED",
  "AI_PROVIDER_REJECTED",
  "AI_PROVIDER_CIRCUIT_OPEN",
  "AI_PROVIDER_RESPONSE_TOO_LARGE",
  "AI_PROVIDER_INVALID_RESPONSE",
] as const;

export type AiGatewayErrorCode = (typeof AI_GATEWAY_ERROR_CODES)[number];

/**
 * SAFE_BEFORE_INFERENCE is deliberately narrow: the provider explicitly rejected the request
 * before work could begin. AMBIGUOUS_AFTER_DISPATCH must never be retried automatically because
 * the provider may already have performed (and billed) inference.
 */
export type AiRetryDisposition =
  "SAFE_BEFORE_INFERENCE" | "AMBIGUOUS_AFTER_DISPATCH" | "NOT_RETRYABLE";

export type AiProviderOutcome = "NOT_STARTED" | "UNKNOWN";

export interface AiErrorUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiGatewayErrorOptions {
  provider: string;
  model?: string;
  /** UNKNOWN means inference/cost may have happened and the full reservation must be charged. */
  outcome?: AiProviderOutcome;
  retryDisposition?: AiRetryDisposition;
  statusCode?: number;
  /** Normalized usage only. Provider body and provider-specific metadata are never retained. */
  usage?: AiErrorUsage;
}

export class AiGatewayError extends Error {
  readonly code: AiGatewayErrorCode;
  readonly provider: string;
  readonly model: string | undefined;
  readonly outcome: AiProviderOutcome;
  readonly retryDisposition: AiRetryDisposition;
  readonly statusCode: number | undefined;
  readonly usage: AiErrorUsage | undefined;

  constructor(code: AiGatewayErrorCode, options: AiGatewayErrorOptions) {
    // Keep the message stable and free of provider response bodies, prompts and credentials.
    super(code);
    this.name = "AiGatewayError";
    this.code = code;
    this.provider = options.provider;
    this.model = options.model;
    this.outcome = options.outcome ?? "UNKNOWN";
    this.retryDisposition = options.retryDisposition ?? "NOT_RETRYABLE";
    this.statusCode = options.statusCode;
    this.usage = options.usage;
  }
}

export function isAiGatewayError(value: unknown): value is AiGatewayError {
  return value instanceof AiGatewayError;
}
