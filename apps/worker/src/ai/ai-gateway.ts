import type { AiCapabilityName, JsonSchema } from "@repairflow/contracts";

export interface AiGatewayImageInput {
  /** MIME type is validated by the capability handler before it reaches the provider boundary. */
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  /** Raw base64 without a data-URL prefix. The gateway must never log or retain this value. */
  base64Data: string;
}

export interface AiGatewayRequest {
  capability: AiCapabilityName;
  promptVersion: string;
  schemaVersion: string;
  systemPrompt: string;
  /** A minimal, allowlisted and redacted capability input. */
  input: unknown;
  images?: readonly AiGatewayImageInput[];
  outputSchema: JsonSchema;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface AiGatewayUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiGatewayResult {
  provider: string;
  model: string;
  output: unknown;
  usage: AiGatewayUsage;
  latencyMs: number;
}

/** Provider-neutral inference boundary. Domain/application code must depend only on this interface. */
export interface AiGateway {
  readonly provider: string;
  readonly model: string;
  generate(request: AiGatewayRequest): Promise<AiGatewayResult>;
}
