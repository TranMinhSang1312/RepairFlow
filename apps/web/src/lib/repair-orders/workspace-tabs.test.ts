import { describe, expect, it } from "vitest";

import { parseWorkspaceTab, workspaceTabUrl } from "./workspace-tabs";

describe("workspace tabs", () => {
  it("parses a durable Work deep link", () => {
    expect(parseWorkspaceTab("?shopId=shop-1&tab=work")).toBe("work");
  });

  it("falls back to overview for missing or invalid tabs", () => {
    expect(parseWorkspaceTab("?shopId=shop-1")).toBe("overview");
    expect(parseWorkspaceTab("?tab=unknown")).toBe("overview");
  });

  it("serializes the next tab while preserving shop and unrelated parameters", () => {
    expect(workspaceTabUrl("order/1", "?shopId=shop-1&from=board", "quote")).toBe(
      "/orders/order%2F1?shopId=shop-1&from=board&tab=quote",
    );
  });
});
