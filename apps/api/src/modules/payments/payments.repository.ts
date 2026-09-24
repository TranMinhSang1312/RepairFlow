/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { ActorType, Prisma, QuoteStatus, type PaymentMethod } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";

const bindingQuoteSelect = {
  id: true,
  versionNo: true,
  approval: { select: { approvedTotal: true } },
} satisfies Prisma.QuoteVersionSelect;

export const paymentOrderSelect = {
  id: true,
  status: true,
  completionOutcome: true,
  lockVersion: true,
  handover: { select: { id: true, paymentDisposition: true } },
  payments: {
    orderBy: [{ receivedAt: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      amount: true,
      method: true,
      reference: true,
      receivedByUserId: true,
      receivedAt: true,
    },
  },
  quoteVersions: {
    where: {
      status: { in: [QuoteStatus.ACCEPTED, QuoteStatus.PARTIALLY_ACCEPTED] },
      approval: { isNot: null },
    },
    orderBy: [{ versionNo: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: bindingQuoteSelect,
  },
} satisfies Prisma.RepairOrderSelect;

export type PaymentOrderRecord = Prisma.RepairOrderGetPayload<{
  select: typeof paymentOrderSelect;
}>;

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  lockOrder(transaction: Prisma.TransactionClient, shopId: string, repairOrderId: string) {
    return transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${shopId}:${repairOrderId}`}, 0)
      )::text AS locked
    `;
  }

  findOrder(transaction: Prisma.TransactionClient, shopId: string, repairOrderId: string) {
    return transaction.repairOrder.findFirst({
      where: { shopId, id: repairOrderId },
      select: paymentOrderSelect,
    });
  }

  createPayment(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      amount: bigint;
      method: PaymentMethod;
      reference: string | null;
      actorUserId: string;
      receivedAt: Date;
    },
  ) {
    return transaction.payment.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        receivedByUserId: input.actorUserId,
        receivedAt: input.receivedAt,
      },
    });
  }

  async appendPaymentArtifacts(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      actorUserId: string;
      requestId: string;
      receivedAt: Date;
    },
  ): Promise<void> {
    await transaction.orderEvent.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        eventType: "PAYMENT_RECORDED",
        actorType: ActorType.USER,
        actorUserId: input.actorUserId,
        publicPayload: { message: "A payment was recorded." },
        privatePayload: { paymentRecorded: true },
        requestId: input.requestId,
        createdAt: input.receivedAt,
      },
    });
    await transaction.auditLog.create({
      data: {
        shopId: input.shopId,
        actorUserId: input.actorUserId,
        action: "PAYMENT_RECORDED",
        entityType: "REPAIR_ORDER",
        entityId: input.repairOrderId,
        beforeData: Prisma.JsonNull,
        afterData: { paymentRecorded: true },
        requestId: input.requestId,
        createdAt: input.receivedAt,
      },
    });
  }
}
