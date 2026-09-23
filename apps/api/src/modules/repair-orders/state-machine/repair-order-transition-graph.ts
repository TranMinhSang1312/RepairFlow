import { RepairOrderStatus } from "@prisma/client";

export const RepairOrderTransitionSource = {
  DIRECT: "DIRECT",
  QUOTE_SEND: "QUOTE_SEND",
  QUOTE_DECISION: "QUOTE_DECISION",
  QC_RUN: "QC_RUN",
  HANDOVER: "HANDOVER",
} as const;

export type RepairOrderTransitionSource =
  (typeof RepairOrderTransitionSource)[keyof typeof RepairOrderTransitionSource];

const edge = (from: RepairOrderStatus, to: RepairOrderStatus): string => `${from}:${to}`;

const TRANSITION_SOURCES = new Map<string, ReadonlySet<RepairOrderTransitionSource>>([
  [
    edge(RepairOrderStatus.RECEIVED, RepairOrderStatus.DIAGNOSING),
    new Set([RepairOrderTransitionSource.DIRECT]),
  ],
  [
    edge(RepairOrderStatus.RECEIVED, RepairOrderStatus.VOIDED),
    new Set([RepairOrderTransitionSource.DIRECT]),
  ],
  [
    edge(RepairOrderStatus.AWAITING_APPROVAL, RepairOrderStatus.DIAGNOSING),
    new Set([RepairOrderTransitionSource.DIRECT]),
  ],
  [
    edge(RepairOrderStatus.DIAGNOSING, RepairOrderStatus.AWAITING_APPROVAL),
    new Set([RepairOrderTransitionSource.DIRECT, RepairOrderTransitionSource.QUOTE_SEND]),
  ],
  [
    edge(RepairOrderStatus.DIAGNOSING, RepairOrderStatus.READY_FOR_PICKUP),
    new Set([RepairOrderTransitionSource.DIRECT]),
  ],
  [
    edge(RepairOrderStatus.AWAITING_APPROVAL, RepairOrderStatus.APPROVED),
    new Set([RepairOrderTransitionSource.QUOTE_DECISION]),
  ],
  [
    edge(RepairOrderStatus.AWAITING_APPROVAL, RepairOrderStatus.READY_FOR_PICKUP),
    new Set([RepairOrderTransitionSource.QUOTE_DECISION]),
  ],
  [
    edge(RepairOrderStatus.APPROVED, RepairOrderStatus.WAITING_PARTS),
    new Set([RepairOrderTransitionSource.DIRECT]),
  ],
  [
    edge(RepairOrderStatus.APPROVED, RepairOrderStatus.REPAIRING),
    new Set([RepairOrderTransitionSource.DIRECT]),
  ],
  [
    edge(RepairOrderStatus.WAITING_PARTS, RepairOrderStatus.REPAIRING),
    new Set([RepairOrderTransitionSource.DIRECT]),
  ],
  [
    edge(RepairOrderStatus.REPAIRING, RepairOrderStatus.AWAITING_APPROVAL),
    new Set([RepairOrderTransitionSource.QUOTE_SEND]),
  ],
  [
    edge(RepairOrderStatus.REPAIRING, RepairOrderStatus.QUALITY_CHECK),
    new Set([RepairOrderTransitionSource.DIRECT]),
  ],
  [
    edge(RepairOrderStatus.QUALITY_CHECK, RepairOrderStatus.REPAIRING),
    new Set([RepairOrderTransitionSource.QC_RUN]),
  ],
  [
    edge(RepairOrderStatus.QUALITY_CHECK, RepairOrderStatus.READY_FOR_PICKUP),
    new Set([RepairOrderTransitionSource.DIRECT]),
  ],
  [
    edge(RepairOrderStatus.READY_FOR_PICKUP, RepairOrderStatus.COMPLETED),
    new Set([RepairOrderTransitionSource.HANDOVER]),
  ],
]);

export function isSupportedTransition(
  from: RepairOrderStatus,
  to: RepairOrderStatus,
  source?: RepairOrderTransitionSource,
): boolean {
  const sources = TRANSITION_SOURCES.get(edge(from, to));
  return source ? Boolean(sources?.has(source)) : Boolean(sources);
}

export function isDirectTransition(from: RepairOrderStatus, to: RepairOrderStatus): boolean {
  return isSupportedTransition(from, to, RepairOrderTransitionSource.DIRECT);
}
