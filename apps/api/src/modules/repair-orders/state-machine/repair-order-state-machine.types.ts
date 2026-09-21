import type {
  ActorType,
  CompletionOutcome,
  MembershipRole,
  Prisma,
  RepairOrderStatus,
} from "@prisma/client";

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
  actor: TransitionActor;
  requestId: string;
}

export type TransactionClient = Prisma.TransactionClient;
