/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import {
  ActorType,
  PartRequirementStatus,
  Prisma,
  QuoteStatus,
  type PartRequirement,
  type PartUsed,
  type QuoteQuantityUnit,
  type WorkLogType,
} from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";

const executionOrderInclude = {
  assignments: {
    where: { unassignedAt: null },
    orderBy: [{ assignedAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: { technicianUserId: true },
  },
  quoteVersions: {
    where: {
      status: { in: [QuoteStatus.ACCEPTED, QuoteStatus.PARTIALLY_ACCEPTED] },
      approval: { isNot: null },
    },
    orderBy: [{ versionNo: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: {
      id: true,
      versionNo: true,
      approval: {
        select: {
          decision: true,
          approvedItemSnapshot: true,
          approvedTotal: true,
          decidedAt: true,
        },
      },
    },
  },
  workLogs: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: { quoteItem: { select: { scopeKey: true } } },
  },
  partRequirements: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  },
  partsUsed: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.RepairOrderInclude;

export type ExecutionOrderRecord = Prisma.RepairOrderGetPayload<{
  include: typeof executionOrderInclude;
}>;

@Injectable()
export class ServiceExecutionRepository {
  constructor(private readonly prisma: PrismaService) {}

  lock(transaction: Prisma.TransactionClient, shopId: string, repairOrderId: string) {
    return transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${shopId}:${repairOrderId}`}, 0)
      )::text AS locked
    `;
  }

  findOrder(
    transaction: Prisma.TransactionClient,
    shopId: string,
    repairOrderId: string,
  ): Promise<ExecutionOrderRecord | null> {
    return transaction.repairOrder.findFirst({
      where: { shopId, id: repairOrderId },
      include: executionOrderInclude,
    });
  }

  findRequirement(
    transaction: Prisma.TransactionClient,
    shopId: string,
    partRequirementId: string,
  ) {
    return transaction.partRequirement.findFirst({
      where: { shopId, id: partRequirementId },
    });
  }

  async createWorkLog(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      quoteItemId: string | null;
      supersedesId: string | null;
      type: WorkLogType;
      content: string;
      actorUserId: string;
    },
  ) {
    return transaction.workLog.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        quoteItemId: input.quoteItemId,
        supersedesId: input.supersedesId,
        type: input.type,
        content: input.content,
        createdByUserId: input.actorUserId,
      },
      include: { quoteItem: { select: { scopeKey: true } } },
    });
  }

  createPartRequirement(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      quoteItemId: string;
      scopeKey: string;
      nameSnapshot: string;
      sku: string | null;
      quantity: Prisma.Decimal;
      quantityUnit: QuoteQuantityUnit;
      actorUserId: string;
    },
  ): Promise<PartRequirement> {
    return transaction.partRequirement.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        quoteItemId: input.quoteItemId,
        scopeKey: input.scopeKey,
        nameSnapshot: input.nameSnapshot,
        sku: input.sku,
        quantity: input.quantity,
        quantityUnit: input.quantityUnit,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
      },
    });
  }

  async updatePartRequirement(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      id: string;
      currentStatus: PartRequirementStatus;
      targetStatus: PartRequirementStatus;
      expectedLockVersion: number;
      actorUserId: string;
    },
  ): Promise<PartRequirement | null> {
    const result = await transaction.partRequirement.updateMany({
      where: {
        shopId: input.shopId,
        id: input.id,
        status: input.currentStatus,
        lockVersion: input.expectedLockVersion,
      },
      data: {
        status: input.targetStatus,
        lockVersion: { increment: 1 },
        updatedByUserId: input.actorUserId,
      },
    });
    if (result.count !== 1) return null;
    return transaction.partRequirement.findUnique({
      where: { shopId_id: { shopId: input.shopId, id: input.id } },
    });
  }

  createPartUsed(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      quoteItemId: string;
      scopeKey: string;
      supersedesId: string | null;
      name: string;
      sku: string | null;
      quantity: Prisma.Decimal;
      unitCost: bigint | null;
      unitSalePrice: bigint | null;
      actorUserId: string;
    },
  ): Promise<PartUsed> {
    return transaction.partUsed.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        quoteItemId: input.quoteItemId,
        scopeKey: input.scopeKey,
        supersedesId: input.supersedesId,
        name: input.name,
        sku: input.sku,
        quantity: input.quantity,
        unitCost: input.unitCost,
        unitSalePrice: input.unitSalePrice,
        createdByUserId: input.actorUserId,
      },
    });
  }

  appendEvent(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      eventType: string;
      actorUserId: string;
      requestId: string;
      publicPayload: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      privatePayload: Prisma.InputJsonValue;
    },
  ) {
    return transaction.orderEvent.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        eventType: input.eventType,
        actorType: ActorType.USER,
        actorUserId: input.actorUserId,
        publicPayload: input.publicPayload,
        privatePayload: input.privatePayload,
        requestId: input.requestId,
      },
    });
  }
}
