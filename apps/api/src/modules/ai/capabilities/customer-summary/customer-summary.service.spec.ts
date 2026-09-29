import { describe, expect, it } from "vitest";

import { sanitizeCustomerSummaryFact } from "./customer-summary.service.js";

describe("sanitizeCustomerSummaryFact", () => {
  it("removes markup, links, customer identifiers, credentials and internal costs", () => {
    const sanitized = sanitizeCustomerSummaryFact(
      "<b>Pin phồng</b> liên hệ 0901234567, owner@example.com; password: secret123; giá 500.000 VND; https://internal.test",
    );
    expect(sanitized).toContain("Pin phồng");
    expect(sanitized).not.toContain("<b>");
    expect(sanitized).not.toContain("0901234567");
    expect(sanitized).not.toContain("owner@example.com");
    expect(sanitized).not.toContain("secret123");
    expect(sanitized).not.toContain("500.000");
    expect(sanitized).not.toContain("giá");
    expect(sanitized).not.toContain("internal.test");
    expect(sanitized).not.toContain("[REDACTED");
  });

  it("normalizes and bounds fact text after redaction", () => {
    const sanitized = sanitizeCustomerSummaryFact(`  ${"Kiểm tra nguồn ".repeat(300)}  `);
    expect(sanitized).not.toMatch(/\s{2,}/u);
    expect(sanitized.length).toBeLessThanOrEqual(2000);
  });

  it("does not confuse a technical assessment with a price label", () => {
    expect(sanitizeCustomerSummaryFact("Đã đánh giá tình trạng pin và kiểm tra nguồn.")).toBe(
      "Đã đánh giá tình trạng pin và kiểm tra nguồn.",
    );
  });
});
