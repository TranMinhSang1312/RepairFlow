import { RepairOrderStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { isSupportedTransition } from "../src/modules/repair-orders/state-machine/repair-order-transition-graph.js";

const supported = new Set([
  `${RepairOrderStatus.RECEIVED}:${RepairOrderStatus.DIAGNOSING}`,
  `${RepairOrderStatus.RECEIVED}:${RepairOrderStatus.VOIDED}`,
  `${RepairOrderStatus.AWAITING_APPROVAL}:${RepairOrderStatus.DIAGNOSING}`,
  `${RepairOrderStatus.DIAGNOSING}:${RepairOrderStatus.AWAITING_APPROVAL}`,
  `${RepairOrderStatus.REPAIRING}:${RepairOrderStatus.AWAITING_APPROVAL}`,
]);

describe("RF-032 transition graph", () => {
  it("allows exactly the contracted edges and rejects every other source/target pair", () => {
    for (const from of Object.values(RepairOrderStatus)) {
      for (const to of Object.values(RepairOrderStatus)) {
        expect(isSupportedTransition(from, to), `${from} -> ${to}`).toBe(
          supported.has(`${from}:${to}`),
        );
      }
    }
  });
});
