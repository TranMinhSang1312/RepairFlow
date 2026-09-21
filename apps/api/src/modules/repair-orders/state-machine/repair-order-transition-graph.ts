import { RepairOrderStatus } from "@prisma/client";

const SUPPORTED_TRANSITIONS = new Set<string>([
  `${RepairOrderStatus.RECEIVED}:${RepairOrderStatus.DIAGNOSING}`,
  `${RepairOrderStatus.RECEIVED}:${RepairOrderStatus.VOIDED}`,
  `${RepairOrderStatus.AWAITING_APPROVAL}:${RepairOrderStatus.DIAGNOSING}`,
]);

export function isSupportedTransition(from: RepairOrderStatus, to: RepairOrderStatus): boolean {
  return SUPPORTED_TRANSITIONS.has(`${from}:${to}`);
}
