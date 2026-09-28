import type { AiGatewayUsage } from "./ai-gateway.js";

const TOKENS_PER_MILLION = 1_000_000n;

export interface AiPriceTable {
  version: string;
  provider: string;
  model: string;
  inputPriceMicrousdPerMillionTokens: bigint;
  outputPriceMicrousdPerMillionTokens: bigint;
}

export interface AiCostResult {
  priceTableVersion: string;
  estimatedCostMicrousd: bigint;
}

/** Pure, integer-only cost calculation. The combined amount is rounded up to one micro-USD. */
export class AiPriceCalculator {
  constructor(private readonly table: AiPriceTable) {
    if (!table.version.trim() || !table.provider.trim() || !table.model.trim()) {
      throw new RangeError("price table version, provider and model are required");
    }
    if (
      table.inputPriceMicrousdPerMillionTokens < 0n ||
      table.outputPriceMicrousdPerMillionTokens < 0n
    ) {
      throw new RangeError("token prices cannot be negative");
    }
  }

  calculate(provider: string, model: string, usage: AiGatewayUsage): AiCostResult {
    if (provider !== this.table.provider || model !== this.table.model) {
      throw new RangeError("provider/model does not match the price table");
    }
    assertTokenCount(usage.inputTokens, "inputTokens");
    assertTokenCount(usage.outputTokens, "outputTokens");

    const numerator =
      BigInt(usage.inputTokens) * this.table.inputPriceMicrousdPerMillionTokens +
      BigInt(usage.outputTokens) * this.table.outputPriceMicrousdPerMillionTokens;

    return {
      priceTableVersion: this.table.version,
      estimatedCostMicrousd:
        numerator === 0n ? 0n : (numerator + TOKENS_PER_MILLION - 1n) / TOKENS_PER_MILLION,
    };
  }
}

function assertTokenCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
}
