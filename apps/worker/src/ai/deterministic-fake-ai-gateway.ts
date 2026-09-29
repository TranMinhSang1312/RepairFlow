import { AiGatewayError } from "./ai-errors.js";
import type { AiGateway, AiGatewayRequest, AiGatewayResult } from "./ai-gateway.js";

export type DeterministicFakeAiScenario =
  "SUCCESS" | "TIMEOUT" | "UNAVAILABLE" | "INVALID_JSON" | "INVALID_OUTPUT";

export interface DeterministicFakeAiGatewayOptions {
  scenario?: DeterministicFakeAiScenario;
  output?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  model?: string;
}

/** Test/local adapter. It performs no I/O and retains no request data. */
export class DeterministicFakeAiGateway implements AiGateway {
  readonly provider = "fake";
  readonly model: string;
  private callCount = 0;

  constructor(private readonly options: DeterministicFakeAiGatewayOptions = {}) {
    this.model = options.model ?? "fake-deterministic-v1";
  }

  generate(request: AiGatewayRequest): Promise<AiGatewayResult> {
    this.callCount += 1;
    const scenario = this.options.scenario ?? "SUCCESS";

    if (scenario === "TIMEOUT") {
      return Promise.reject(
        new AiGatewayError("AI_PROVIDER_TIMEOUT", {
          provider: "fake",
          model: this.model,
          outcome: "UNKNOWN",
          retryDisposition: "AMBIGUOUS_AFTER_DISPATCH",
        }),
      );
    }
    if (scenario === "UNAVAILABLE") {
      return Promise.reject(
        new AiGatewayError("AI_PROVIDER_UNAVAILABLE", {
          provider: "fake",
          model: this.model,
          outcome: "NOT_STARTED",
          retryDisposition: "SAFE_BEFORE_INFERENCE",
        }),
      );
    }
    if (scenario === "INVALID_JSON") {
      return Promise.reject(
        new AiGatewayError("AI_PROVIDER_INVALID_RESPONSE", {
          provider: "fake",
          model: this.model,
          outcome: "UNKNOWN",
          retryDisposition: "NOT_RETRYABLE",
        }),
      );
    }

    const output =
      scenario === "INVALID_OUTPUT"
        ? { intentionallyInvalid: true }
        : (this.options.output ?? defaultOutput(request));

    return Promise.resolve({
      provider: "fake",
      model: this.model,
      output: structuredClone(output),
      usage: {
        inputTokens: this.options.inputTokens ?? 100,
        outputTokens: this.options.outputTokens ?? 25,
      },
      latencyMs: this.options.latencyMs ?? 1,
    });
  }

  getCallCount(): number {
    return this.callCount;
  }
}

function defaultOutput(request: AiGatewayRequest): unknown {
  switch (request.capability) {
    case "DEVICE_OCR":
      return {
        brand: { value: null, confidence: 0 },
        model: { value: null, confidence: 0 },
        serialNumber: { value: null, confidence: 0 },
        imei: { value: null, confidence: 0 },
        warnings: [],
      };
    case "INTAKE_DRAFT":
      return {
        reportedProblem: "Cần nhân viên xác nhận mô tả sự cố.",
        visibleCondition: "Chưa có thông tin để xác nhận ngoại quan.",
        accessories: [],
        customerClaims: [],
        uncertainties: ["Bản nháp được tạo bởi fake provider."],
      };
    case "CHECKLIST_SUGGESTION":
      return { suggestedItemIds: [], reasoningSummary: "", safetyWarnings: [] };
    case "CUSTOMER_SUMMARY":
      return customerSummaryOutput(request.input);
  }
}

function customerSummaryOutput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      summary: "Bản nháp kỹ thuật cần được nhân viên kiểm tra.",
      claimsUsed: [],
      warnings: [],
    };
  }
  const facts = (input as { facts?: unknown }).facts;
  const maxCharacters = (input as { maxCharacters?: unknown }).maxCharacters;
  if (!Array.isArray(facts) || facts.length === 0) {
    return {
      summary: "Bản nháp kỹ thuật cần được nhân viên kiểm tra.",
      claimsUsed: [],
      warnings: [],
    };
  }
  const first = facts[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return {
      summary: "Bản nháp kỹ thuật cần được nhân viên kiểm tra.",
      claimsUsed: [],
      warnings: [],
    };
  }
  const fact = first as { id?: unknown; text?: unknown };
  if (typeof fact.id !== "string" || typeof fact.text !== "string") {
    return {
      summary: "Bản nháp kỹ thuật cần được nhân viên kiểm tra.",
      claimsUsed: [],
      warnings: [],
    };
  }
  const limit = typeof maxCharacters === "number" ? maxCharacters : 800;
  return {
    summary: fact.text.normalize("NFKC").slice(0, limit),
    claimsUsed: [fact.id],
    warnings: [],
  };
}
