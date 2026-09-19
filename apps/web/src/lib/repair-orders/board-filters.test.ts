import { describe, expect, it } from "vitest";

import { parseBoardFilters, updateBoardUrl } from "./board-filters";

describe("board filters", () => {
  it("parses valid repeated statuses and ignores unknown values", () => {
    const result = parseBoardFilters(
      new URLSearchParams(
        "query=RF-42&status=RECEIVED&status=RECEIVED&status=WRONG&branchId=branch-1",
      ),
    );

    expect(result).toEqual({
      query: "RF-42",
      statuses: ["RECEIVED"],
      branchId: "branch-1",
      technicianUserId: "",
    });
  });

  it("serializes filters and preserves unrelated URL params", () => {
    expect(
      updateBoardUrl(
        "/orders",
        new URLSearchParams("view=compact&status=VOIDED"),
        {
          query: "  Sang  ",
          statuses: ["RECEIVED", "REPAIRING"],
          branchId: "branch-1",
          technicianUserId: "tech-1",
        },
        "shop-1",
      ),
    ).toBe(
      "/orders?view=compact&shopId=shop-1&query=Sang&status=RECEIVED&status=REPAIRING&branchId=branch-1&technicianUserId=tech-1",
    );
  });
});
