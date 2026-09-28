import type { AiCapabilityName } from "@repairflow/contracts";
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
        : (this.options.output ?? defaultOutput(request.capability));

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

function defaultOutput(capability: AiCapabilityName): unknown {
  switch (capability) {
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
      return {
        summary: "Bản nháp kỹ thuật cần được nhân viên kiểm tra.",
        claimsUsed: [],
        warnings: [],
      };
  }
}
