/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { ActorType, Prisma } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";

@Injectable()
export class DiagnosesRepository {
  constructor(private readonly prisma: PrismaService) {}

  withTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(operation);
  }

  lock(transaction: Prisma.TransactionClient, shopId: string, repairOrderId: string) {
    return transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${shopId}:${repairOrderId}`}, 0)
      )::text AS locked
    `;
  }

  findOrder(transaction: Prisma.TransactionClient, shopId: string, repairOrderId: string) {
    return transaction.repairOrder.findFirst({
      where: { shopId, id: repairOrderId },
      select: {
        id: true,
        status: true,
        assignments: {
          where: { unassignedAt: null },
          take: 1,
          select: { technicianUserId: true },
        },
      },
    });
  }

  findSuperseded(
    transaction: Prisma.TransactionClient,
    shopId: string,
    repairOrderId: string,
    supersedesId: string,
  ) {
    return transaction.diagnosis.findFirst({
      where: { id: supersedesId, shopId, repairOrderId },
      select: { id: true },
    });
  }

  async allocateRevision(
    transaction: Prisma.TransactionClient,
    repairOrderId: string,
  ): Promise<number> {
    const aggregate = await transaction.diagnosis.aggregate({
      where: { repairOrderId },
      _max: { revisionNo: true },
    });
    return (aggregate._max.revisionNo ?? 0) + 1;
  }

  async create(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      revisionNo: number;
      finding: string;
      recommendation: string;
      supersedesId: string | null;
      actorUserId: string;
      requestId: string;
    },
  ) {
    const diagnosis = await transaction.diagnosis.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        revisionNo: input.revisionNo,
        finding: input.finding,
        recommendation: input.recommendation,
        supersedesId: input.supersedesId,
        createdByUserId: input.actorUserId,
      },
    });

    await transaction.orderEvent.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        eventType: "DIAGNOSIS_PUBLISHED",
        actorType: ActorType.USER,
        actorUserId: input.actorUserId,
        publicPayload: { message: "A diagnosis revision was recorded." },
        privatePayload: {
          diagnosisId: diagnosis.id,
          revisionNo: diagnosis.revisionNo,
          supersedesId: diagnosis.supersedesId,
        },
        requestId: input.requestId,
      },
    });

    return diagnosis;
  }
}
