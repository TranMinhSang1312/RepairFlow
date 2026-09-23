/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { MediaPurpose, Prisma, QuoteStatus, RepairOrderStatus } from "@prisma/client";

import { PrismaService } from "../../../infra/database/prisma.service.js";
import type {
  RepairOrderTransitionCommand,
  TransactionClient,
} from "./repair-order-state-machine.types.js";

const transitionOrderInclude = {
  shop: { select: { intakePhotoMinimum: true } },
  customer: true,
  device: true,
  assignments: {
    where: { unassignedAt: null },
    orderBy: [{ assignedAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: {
      id: true,
      repairOrderId: true,
      technicianUserId: true,
      assignedByUserId: true,
      assignedAt: true,
      unassignedAt: true,
      technician: { select: { user: { select: { displayName: true } } } },
    },
  },
  media: {
    where: { purpose: MediaPurpose.INTAKE, uploadedAt: { not: null }, expiresAt: null },
    select: { id: true },
  },
  quoteVersions: {
    where: {
      status: {
        in: [
          QuoteStatus.SENT,
          QuoteStatus.ACCEPTED,
          QuoteStatus.PARTIALLY_ACCEPTED,
          QuoteStatus.DECLINED,
        ],
      },
    },
    orderBy: [{ versionNo: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: {
      id: true,
      status: true,
      items: { take: 1, select: { id: true } },
      approval: { select: { decision: true } },
    },
  },
  _count: { select: { quoteVersions: true, payments: true, workLogs: true } },
} satisfies Prisma.RepairOrderInclude;

export type TransitionOrderRecord = Prisma.RepairOrderGetPayload<{
  include: typeof transitionOrderInclude;
}>;

@Injectable()
export class RepairOrderStateMachineRepository {
  constructor(private readonly prisma: PrismaService) {}

  lock(transaction: TransactionClient, shopId: string, repairOrderId: string): Promise<unknown> {
    return transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${shopId}:${repairOrderId}`}, 0))::text AS locked
    `;
  }

  findForTransition(
    transaction: TransactionClient,
    shopId: string,
    repairOrderId: string,
  ): Promise<TransitionOrderRecord | null> {
    return transaction.repairOrder.findFirst({
      where: { shopId, id: repairOrderId },
      include: transitionOrderInclude,
    });
  }

  async updateStatus(
    transaction: TransactionClient,
    command: RepairOrderTransitionCommand,
    fromStatus: RepairOrderStatus,
  ): Promise<boolean> {
    const result = await transaction.repairOrder.updateMany({
      where: {
        shopId: command.shopId,
        id: command.repairOrderId,
        status: fromStatus,
        lockVersion: command.expectedLockVersion,
      },
      data: {
        status: command.targetStatus,
        completionOutcome: command.completionOutcome ?? null,
        ...(command.targetStatus === RepairOrderStatus.READY_FOR_PICKUP
          ? { readyAt: new Date() }
          : {}),
        lockVersion: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  appendEvent(
    transaction: TransactionClient,
    command: RepairOrderTransitionCommand,
    fromStatus: RepairOrderStatus,
  ) {
    return transaction.orderEvent.create({
      data: {
        shopId: command.shopId,
        repairOrderId: command.repairOrderId,
        eventType: "ORDER_STATUS_CHANGED",
        fromStatus,
        toStatus: command.targetStatus,
        actorType: command.actor.type,
        actorUserId: command.actor.userId,
        publicPayload: { status: command.targetStatus },
        privatePayload: command.reason ? { reason: command.reason } : Prisma.JsonNull,
        requestId: command.requestId,
      },
    });
  }
}
