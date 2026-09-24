/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { MediaPurpose, Prisma, RepairOrderStatus } from "@prisma/client";

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
  diagnoses: { select: { id: true }, take: 1 },
  quoteVersions: {
    orderBy: [{ versionNo: "desc" as const }, { id: "desc" as const }],
    select: {
      id: true,
      versionNo: true,
      status: true,
      sentAt: true,
      items: {
        orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
        select: {
          id: true,
          scopeKey: true,
          carriedFromQuoteItemId: true,
          kind: true,
          description: true,
          quantity: true,
          quantityUnit: true,
          unitPrice: true,
          isOptional: true,
          approvalGroup: true,
        },
      },
      approval: { select: { decision: true, approvedItemSnapshot: true } },
    },
  },
  workLogs: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      type: true,
      supersedesId: true,
      quoteItemId: true,
      quoteItem: { select: { scopeKey: true } },
    },
  },
  partRequirements: {
    select: { id: true, quoteItemId: true, scopeKey: true, status: true },
  },
  partsUsed: { select: { id: true, quoteItemId: true, scopeKey: true } },
  qcRuns: {
    orderBy: [{ runNo: "desc" as const }],
    take: 1,
    select: { id: true, runNo: true, result: true, notes: true },
  },
  handover: { select: { id: true, handedOverAt: true } },
  _count: { select: { quoteVersions: true, payments: true, workLogs: true, partsUsed: true } },
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
    order: TransitionOrderRecord,
  ): Promise<boolean> {
    const result = await transaction.repairOrder.updateMany({
      where: {
        shopId: command.shopId,
        id: command.repairOrderId,
        status: order.status,
        lockVersion: command.expectedLockVersion,
      },
      data: {
        status: command.targetStatus,
        ...(command.targetStatus === RepairOrderStatus.READY_FOR_PICKUP
          ? { completionOutcome: command.completionOutcome!, readyAt: new Date() }
          : {}),
        ...(command.targetStatus === RepairOrderStatus.COMPLETED && order.handover
          ? { returnedAt: order.handover.handedOverAt }
          : {}),
        lockVersion: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async incrementLockVersionForQcPass(
    transaction: TransactionClient,
    command: RepairOrderTransitionCommand,
  ): Promise<boolean> {
    const result = await transaction.repairOrder.updateMany({
      where: {
        shopId: command.shopId,
        id: command.repairOrderId,
        status: RepairOrderStatus.QUALITY_CHECK,
        lockVersion: command.expectedLockVersion,
      },
      data: { lockVersion: { increment: 1 } },
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
