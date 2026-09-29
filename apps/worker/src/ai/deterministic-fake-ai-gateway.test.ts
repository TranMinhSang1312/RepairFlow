import { AI_OUTPUT_SCHEMAS, isValidAiOutput, type AiCapabilityName } from "@repairflow/contracts";
import { describe, expect, it } from "vitest";
import type { AiGatewayRequest } from "./ai-gateway.js";
import {
  DeterministicFakeAiGateway,
  type DeterministicFakeAiScenario,
} from "./deterministic-fake-ai-gateway.js";

const CAPABILITIES: readonly AiCapabilityName[] = [
  "DEVICE_OCR",
  "INTAKE_DRAFT",
  "CHECKLIST_SUGGESTION",
  "CUSTOMER_SUMMARY",
];

describe("DeterministicFakeAiGateway", () => {
  it.each(CAPABILITIES)("returns a schema-valid deterministic %s fixture", async (capability) => {
    const gateway = new DeterministicFakeAiGateway();
    const result = await gateway.generate(request(capability));
    expect(result).toMatchObject({
      provider: "fake",
      model: "fake-deterministic-v1",
      usage: { inputTokens: 100, outputTokens: 25 },
      latencyMs: 1,
    });
    expect(isValidAiOutput(capability, result.output)).toBe(true);
    expect(gateway.getCallCount()).toBe(1);
  });

  it("clones configured output instead of retaining a mutable fixture", async () => {
    const fixture = { summary: "Safe", claimsUsed: [], warnings: [] };
    const gateway = new DeterministicFakeAiGateway({ output: fixture });
    const result = await gateway.generate(request("CUSTOMER_SUMMARY"));
    (result.output as { summary: string }).summary = "changed";
    expect(fixture.summary).toBe("Safe");
  });

  it.each<[DeterministicFakeAiScenario, string, string]>([
    ["TIMEOUT", "AI_PROVIDER_TIMEOUT", "UNKNOWN"],
    ["UNAVAILABLE", "AI_PROVIDER_UNAVAILABLE", "NOT_STARTED"],
    ["INVALID_JSON", "AI_PROVIDER_INVALID_RESPONSE", "UNKNOWN"],
  ])("supports the %s scenario", async (scenario, code, outcome) => {
    const gateway = new DeterministicFakeAiGateway({ scenario });
    await expect(gateway.generate(request("CUSTOMER_SUMMARY"))).rejects.toMatchObject({
      code,
      provider: "fake",
      model: "fake-deterministic-v1",
      outcome,
    });
  });

  it("supports schema-invalid output without throwing inside the provider boundary", async () => {
    const gateway = new DeterministicFakeAiGateway({ scenario: "INVALID_OUTPUT" });
    const result = await gateway.generate(request("DEVICE_OCR"));
    expect(isValidAiOutput("DEVICE_OCR", result.output)).toBe(false);
  });
});

function request(capability: AiCapabilityName): AiGatewayRequest {
  return {
    capability,
    promptVersion: "v1",
    schemaVersion: "v1",
    systemPrompt: "Return JSON.",
    input:
      capability === "CUSTOMER_SUMMARY"
        ? {
            tone: "CLEAR_NEUTRAL",
            maxCharacters: 400,
            facts: [{ id: "fact-1", kind: "WORK_LOG", text: "Thiết bị đã được vệ sinh." }],
          }
        : { safe: true },
    outputSchema: AI_OUTPUT_SCHEMAS[capability],
    timeoutMs: 1_000,
    maxOutputBytes: 65_536,
  };
}
