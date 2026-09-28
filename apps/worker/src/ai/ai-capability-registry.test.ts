import { describe, expect, it } from "vitest";

import {
  AI_PROMPT_VERSION,
  AI_SCHEMA_VERSION,
  AiCapabilityRegistry,
} from "./ai-capability-registry.js";

describe("AiCapabilityRegistry", () => {
  const registry = new AiCapabilityRegistry();

  it("resolves only an exact capability, prompt, and schema version", () => {
    expect(registry.resolve("DEVICE_OCR", AI_PROMPT_VERSION, AI_SCHEMA_VERSION)).toMatchObject({
      capability: "DEVICE_OCR",
      promptVersion: AI_PROMPT_VERSION,
      schemaVersion: AI_SCHEMA_VERSION,
    });
    expect(registry.resolve("DEVICE_OCR", "missing", AI_SCHEMA_VERSION)).toBeNull();
    expect(registry.resolve("DEVICE_OCR", AI_PROMPT_VERSION, "missing")).toBeNull();
  });

  it("rejects OCR values outside the requested allowlist and calculates confidence", () => {
    const definition = registry.resolve("DEVICE_OCR", AI_PROMPT_VERSION, AI_SCHEMA_VERSION)!;
    const output = {
      brand: { value: "Apple", confidence: 0.9 },
      model: { value: null, confidence: 0.1 },
      serialNumber: { value: "SERIAL-1", confidence: 0.7 },
      imei: { value: null, confidence: 0.2 },
      warnings: [],
    };
    expect(definition.validateOutput(output, { allowedFields: ["brand", "serialNumber"] })).toBe(
      true,
    );
    expect(definition.confidence(output)).toBeCloseTo(0.8);
    expect(definition.validateOutput(output, { allowedFields: ["brand"] })).toBe(false);
  });

  it("rejects checklist identifiers outside the server-owned catalogue", () => {
    const definition = registry.resolve(
      "CHECKLIST_SUGGESTION",
      AI_PROMPT_VERSION,
      AI_SCHEMA_VERSION,
    )!;
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";
    const base = { reasoningSummary: "Nguồn", safetyWarnings: [] };
    const input = { allowedChecklistItems: [{ id: firstId, label: "Nguồn" }] };
    expect(definition.validateOutput({ ...base, suggestedItemIds: [firstId] }, input)).toBe(true);
    expect(definition.validateOutput({ ...base, suggestedItemIds: [secondId] }, input)).toBe(false);
  });

  it("rejects customer-summary claims absent from approved facts", () => {
    const definition = registry.resolve("CUSTOMER_SUMMARY", AI_PROMPT_VERSION, AI_SCHEMA_VERSION)!;
    const input = { approvedFacts: ["Pin đã chai"] };
    expect(
      definition.validateOutput(
        { summary: "Pin đã xuống cấp.", claimsUsed: ["Pin đã chai"], warnings: [] },
        input,
      ),
    ).toBe(true);
    expect(
      definition.validateOutput(
        { summary: "Đã thay pin.", claimsUsed: ["Đã thay pin"], warnings: [] },
        input,
      ),
    ).toBe(false);
  });
});
