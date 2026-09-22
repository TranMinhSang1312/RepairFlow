import { QuoteItemKind } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { calculateQuote } from "./quote-calculator.js";

const item = (quantity: number, unitPrice: number) => ({
  kind: QuoteItemKind.SERVICE,
  description: "Decimal-safe service",
  quantity,
  unitPrice,
  isOptional: false,
  approvalGroup: null,
});

describe("quote calculator", () => {
  it("rounds each line half-up to integer VND without binary floating-point money math", () => {
    const result = calculateQuote([item(1.25, 1001), item(0.5, 999), item(0.1, 4)], 51);

    expect(result.items.map((entry) => entry.lineTotal)).toEqual([1251n, 500n, 0n]);
    expect(result).toMatchObject({ subtotal: 1751n, discount: 51n, total: 1700n });
  });

  it("applies the quote-level discount once and preserves a negative result for validation", () => {
    const result = calculateQuote([item(0.01, 1)], 1);
    const invalid = calculateQuote([item(1, 100)], 101);

    expect(result).toMatchObject({ subtotal: 0n, discount: 1n, total: -1n });
    expect(invalid.total).toBe(-1n);
  });
});
