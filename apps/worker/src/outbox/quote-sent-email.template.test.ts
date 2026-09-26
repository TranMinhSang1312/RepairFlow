import { describe, expect, it } from "vitest";

import { renderQuoteSentEmail } from "./quote-sent-email.template.js";

describe("quote sent email template", () => {
  it("renders customer-safe content and escapes snapshot values", () => {
    const result = renderQuoteSentEmail({
      shopName: '<script>alert("shop")</script>',
      customerName: "Customer\r\nBcc: attacker@example.test",
      orderCode: "RF-2026-000001",
      deviceLabel: "Apple <iPhone>",
      total: 1_250_000n,
      currency: "VND",
      expiresAt: new Date("2026-09-30T01:00:00.000Z"),
      publicUrl: "https://app.example.test/p/private-token?a=1&b=2",
    });

    expect(result.subject).not.toContain("\n");
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("a=1&amp;b=2");
    expect(result.text).toContain("1.250.000 VND");
    expect(result.text).not.toContain("internal");
  });
});
