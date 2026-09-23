import type {
  ActorType,
  CompletionOutcome,
  MembershipRole,
  Prisma,
  RepairOrderStatus,
} from "@prisma/client";

import type { RepairOrderTransitionSource } from "./repair-order-transition-graph.js";

export interface TransitionActor {
  type: ActorType;
  userId: string | null;
  role: MembershipRole | null;
}

export interface RepairOrderTransitionCommand {
  shopId: string;
  repairOrderId: string;
  targetStatus: RepairOrderStatus;
  completionOutcome?: CompletionOutcome | null;
  reason?: string | null;
  expectedLockVersion: number;
  source: RepairOrderTransitionSource;
  /** Server-owned evidence staged by an internal caller in the same transaction. */
  evidenceId?: string | null;
  actor: TransitionActor;
  requestId: string;
}

export type InternalRepairOrderTransitionCommand = Omit<RepairOrderTransitionCommand, "source">;

export type TransactionClient = Prisma.TransactionClient;
