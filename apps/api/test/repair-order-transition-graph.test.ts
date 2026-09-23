import { RepairOrderStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  isSupportedTransition,
  RepairOrderTransitionSource,
} from "../src/modules/repair-orders/state-machine/repair-order-transition-graph.js";

const supported = new Set([
  `${RepairOrderStatus.RECEIVED}:${RepairOrderStatus.DIAGNOSING}`,
  `${RepairOrderStatus.RECEIVED}:${RepairOrderStatus.VOIDED}`,
  `${RepairOrderStatus.AWAITING_APPROVAL}:${RepairOrderStatus.DIAGNOSING}`,
  `${RepairOrderStatus.DIAGNOSING}:${RepairOrderStatus.AWAITING_APPROVAL}`,
  `${RepairOrderStatus.DIAGNOSING}:${RepairOrderStatus.READY_FOR_PICKUP}`,
  `${RepairOrderStatus.REPAIRING}:${RepairOrderStatus.AWAITING_APPROVAL}`,
  `${RepairOrderStatus.AWAITING_APPROVAL}:${RepairOrderStatus.APPROVED}`,
  `${RepairOrderStatus.AWAITING_APPROVAL}:${RepairOrderStatus.READY_FOR_PICKUP}`,
  `${RepairOrderStatus.APPROVED}:${RepairOrderStatus.WAITING_PARTS}`,
  `${RepairOrderStatus.APPROVED}:${RepairOrderStatus.REPAIRING}`,
  `${RepairOrderStatus.WAITING_PARTS}:${RepairOrderStatus.REPAIRING}`,
  `${RepairOrderStatus.REPAIRING}:${RepairOrderStatus.QUALITY_CHECK}`,
  `${RepairOrderStatus.QUALITY_CHECK}:${RepairOrderStatus.REPAIRING}`,
  `${RepairOrderStatus.QUALITY_CHECK}:${RepairOrderStatus.READY_FOR_PICKUP}`,
  `${RepairOrderStatus.READY_FOR_PICKUP}:${RepairOrderStatus.COMPLETED}`,
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

  it("keeps quote, QC, decision and handover edges unavailable to direct commands", () => {
    expect(
      isSupportedTransition(
        RepairOrderStatus.REPAIRING,
        RepairOrderStatus.AWAITING_APPROVAL,
        RepairOrderTransitionSource.DIRECT,
      ),
    ).toBe(false);
    expect(
      isSupportedTransition(
        RepairOrderStatus.QUALITY_CHECK,
        RepairOrderStatus.REPAIRING,
        RepairOrderTransitionSource.DIRECT,
      ),
    ).toBe(false);
    expect(
      isSupportedTransition(
        RepairOrderStatus.READY_FOR_PICKUP,
        RepairOrderStatus.COMPLETED,
        RepairOrderTransitionSource.DIRECT,
      ),
    ).toBe(false);
  });
});
