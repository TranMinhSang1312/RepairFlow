import { describe, expect, it } from "vitest";

import { safeStaffNext } from "./safe-next";

describe("safeStaffNext", () => {
  it("keeps allowed staff paths with query and hash", () => {
    expect(safeStaffNext("/orders/abc?shopId=one#timeline")).toBe(
      "/orders/abc?shopId=one#timeline",
    );
    expect(safeStaffNext("/intake?shopId=one")).toBe("/intake?shopId=one");
  });

  it.each([
    "https://evil.example/orders",
    "//evil.example/orders",
    "/\\evil.example/orders",
    "/settings",
    "javascript:alert(1)",
    "/orders\n/next",
  ])("falls back for unsafe destination %s", (value) => {
    expect(safeStaffNext(value)).toBe("/orders");
  });
});
