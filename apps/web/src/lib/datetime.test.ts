import { describe, expect, it } from "vitest";

import { formatShopDateTimeLocal, parseShopDateTimeLocal } from "./datetime";

describe("shop timezone datetime conversion", () => {
  it("round-trips a datetime-local value in the shop timezone", () => {
    const instant = parseShopDateTimeLocal("2026-09-30T14:45", "Asia/Ho_Chi_Minh");

    expect(instant?.toISOString()).toBe("2026-09-30T07:45:00.000Z");
    expect(formatShopDateTimeLocal(instant, "Asia/Ho_Chi_Minh")).toBe("2026-09-30T14:45");
  });

  it("uses the safe default timezone when configuration is invalid", () => {
    expect(formatShopDateTimeLocal("2026-09-30T07:45:00.000Z", "not/a-timezone")).toBe(
      "2026-09-30T14:45",
    );
  });

  it("rejects malformed datetime-local input", () => {
    expect(parseShopDateTimeLocal("30/09/2026 14:45", "Asia/Ho_Chi_Minh")).toBeNull();
  });
});
