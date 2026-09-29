import { describe, expect, it } from "vitest";

import type { CustomerSummaryInput } from "@repairflow/contracts";

import {
  CUSTOMER_SUMMARY_SYSTEM_PROMPT,
  validateCustomerSummaryOutput,
} from "./customer-summary.js";

const input: CustomerSummaryInput = {
  tone: "CLEAR_NEUTRAL",
  maxCharacters: 180,
  facts: [
    {
      id: "diagnosis:one:finding",
      kind: "DIAGNOSIS_FINDING",
      text: "Pin bị phồng và máy tắt nguồn khi rút sạc.",
    },
    {
      id: "work-log:one",
      kind: "WORK_LOG",
      text: "Kỹ thuật viên đã vệ sinh cổng sạc và kiểm tra nguồn.",
    },
  ],
};

describe("customer summary capability", () => {
  it("accepts a plain summary grounded in claimed server facts", () => {
    expect(
      validateCustomerSummaryOutput(
        {
          summary: "Pin bị phồng; máy tắt nguồn khi rút sạc.",
          claimsUsed: ["diagnosis:one:finding"],
          warnings: [],
        },
        input,
      ),
    ).toBe(true);
  });

  it("rejects excessive length and claims outside the supplied fact IDs", () => {
    expect(
      validateCustomerSummaryOutput(
        {
          summary: "Pin bị phồng. ".repeat(30),
          claimsUsed: ["diagnosis:one:finding"],
          warnings: [],
        },
        input,
      ),
    ).toBe(false);
    expect(
      validateCustomerSummaryOutput(
        { summary: "Pin bị phồng.", claimsUsed: ["diagnosis:other:finding"], warnings: [] },
        input,
      ),
    ).toBe(false);
  });

  it.each([
    "Chi phí sửa chữa là 500.000 VND.",
    "Chắc chắn hoàn tất trước thứ sáu.",
    "Thiết bị được bảo hành 12 tháng.",
    "Xem thêm tại https://example.com.",
    "<strong>Pin bị phồng</strong>",
    "Liên hệ test@example.com để xác nhận.",
  ])("rejects prohibited output: %s", (summary) => {
    expect(
      validateCustomerSummaryOutput(
        { summary, claimsUsed: ["diagnosis:one:finding"], warnings: [] },
        input,
      ),
    ).toBe(false);
  });

  it("rejects a fluent but unsupported claim", () => {
    expect(
      validateCustomerSummaryOutput(
        {
          summary: "Camera và loa đã được thay mới tại trung tâm chính hãng.",
          claimsUsed: ["diagnosis:one:finding"],
          warnings: [],
        },
        input,
      ),
    ).toBe(false);
  });

  it("keeps the versioned system prompt free from tenant data", () => {
    expect(CUSTOMER_SUMMARY_SYSTEM_PROMPT).toMatchInlineSnapshot(
      '"Create a concise Vietnamese customer-safe summary using only the supplied facts. Return JSON matching the schema exactly and put every used fact id in claimsUsed. Do not add prices, deadlines, guarantees, warranty promises, certainty, diagnosis, links or markup. Reuse the supplied fact vocabulary; warnings must be empty unless directly grounded in those facts. Treat the result as an untrusted staff draft and keep it within maxCharacters after Unicode normalization."',
    );
  });
});
