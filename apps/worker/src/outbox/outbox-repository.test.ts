import { describe, expect, it } from "vitest";

import { OutboxDeliveryError, safeOutboxErrorCode } from "./outbox-errors.js";
import { retryDelayMs } from "./outbox-repository.js";

describe("outbox retry policy", () => {
  it("uses bounded exponential backoff", () => {
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, 1000, 5000))).toEqual([
      1000, 2000, 4000, 5000, 5000,
    ]);
  });

  it("persists allowlisted codes instead of provider messages", () => {
    expect(safeOutboxErrorCode(new OutboxDeliveryError("EMAIL_TEMPORARY_FAILURE"))).toBe(
      "EMAIL_TEMPORARY_FAILURE",
    );
    expect(safeOutboxErrorCode(new Error("secret provider response"))).toBe(
      "UNEXPECTED_DELIVERY_FAILURE",
    );
    expect(safeOutboxErrorCode(new OutboxDeliveryError("unsafe message with spaces"))).toBe(
      "UNEXPECTED_DELIVERY_FAILURE",
    );
  });
});
