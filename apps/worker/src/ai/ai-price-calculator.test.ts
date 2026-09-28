import { describe, expect, it } from "vitest";
import { AiPriceCalculator } from "./ai-price-calculator.js";

describe("AiPriceCalculator", () => {
  const calculator = new AiPriceCalculator({
    version: "deepseek-2026-09",
    provider: "deepseek",
    model: "deepseek-flash",
    inputPriceMicrousdPerMillionTokens: 280_000n,
    outputPriceMicrousdPerMillionTokens: 420_000n,
  });

  it("uses integer arithmetic and rounds the combined charge up once", () => {
    expect(
      calculator.calculate("deepseek", "deepseek-flash", {
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).toEqual({ priceTableVersion: "deepseek-2026-09", estimatedCostMicrousd: 1n });

    expect(
      calculator.calculate("deepseek", "deepseek-flash", {
        inputTokens: 1_000_000,
        outputTokens: 2_000_000,
      }).estimatedCostMicrousd,
    ).toBe(1_120_000n);
  });

  it("returns zero for zero usage", () => {
    expect(
      calculator.calculate("deepseek", "deepseek-flash", {
        inputTokens: 0,
        outputTokens: 0,
      }).estimatedCostMicrousd,
    ).toBe(0n);
  });

  it("rejects mismatched price tables and unsafe token counts", () => {
    expect(() =>
      calculator.calculate("fake", "deepseek-flash", { inputTokens: 1, outputTokens: 1 }),
    ).toThrow("provider/model does not match");
    expect(() =>
      calculator.calculate("deepseek", "deepseek-flash", {
        inputTokens: Number.MAX_SAFE_INTEGER + 1,
        outputTokens: 0,
      }),
    ).toThrow("inputTokens");
    expect(() =>
      calculator.calculate("deepseek", "deepseek-flash", {
        inputTokens: 0,
        outputTokens: -1,
      }),
    ).toThrow("outputTokens");
  });

  it("rejects invalid price tables", () => {
    expect(
      () =>
        new AiPriceCalculator({
          version: "v1",
          provider: "deepseek",
          model: "deepseek-flash",
          inputPriceMicrousdPerMillionTokens: -1n,
          outputPriceMicrousdPerMillionTokens: 0n,
        }),
    ).toThrow("cannot be negative");
  });
});
