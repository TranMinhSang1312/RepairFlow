import { PaymentMethod } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  calculatePaymentSummary,
  toPaymentSummaryView,
  toPaymentView,
} from "../src/modules/payments/payment.types.js";

describe("authoritative payment calculation", () => {
  it("sums immutable receipts and clamps amount due at zero", () => {
    expect(calculatePaymentSummary(100_000n, [{ amount: 25_000n }, { amount: 50_000n }])).toEqual({
      approvedTotal: 100_000n,
      paidTotal: 75_000n,
      amountDue: 25_000n,
    });
    expect(calculatePaymentSummary(10n, [{ amount: 12n }]).amountDue).toBe(0n);
  });

  it("maps bigint money only inside the JSON safe-integer range", () => {
    expect(toPaymentSummaryView({ approvedTotal: 100n, paidTotal: 40n, amountDue: 60n })).toEqual({
      approvedTotal: 100,
      paidTotal: 40,
      amountDue: 60,
    });
    expect(() =>
      toPaymentView({
        id: "payment",
        amount: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        method: PaymentMethod.CASH,
        reference: null,
        receivedByUserId: "user",
        receivedAt: new Date(0),
      }),
    ).toThrow("safe-integer");
  });
});
