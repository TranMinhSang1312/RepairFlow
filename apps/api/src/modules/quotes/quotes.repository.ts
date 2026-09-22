/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { ActorType, Prisma } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";
import type { QuoteCalculation } from "./quote-calculator.js";

const quoteInclude = {
  items: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.QuoteVersionInclude;

interface PersistDraftInput {
  diagnosisId: string | null;
  calculation: QuoteCalculation;
  customerNote: string | null;
  expiresAt: Date | null;
}

@Injectable()
export class QuotesRepository {
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
      select: { id: true, status: true },
    });
  }

  findQuoteReference(
    transaction: Prisma.TransactionClient,
    shopId: string,
    quoteVersionId: string,
  ) {
    return transaction.quoteVersion.findFirst({
      where: { shopId, id: quoteVersionId },
      select: { repairOrderId: true },
    });
  }

  findQuoteForUpdate(
    transaction: Prisma.TransactionClient,
    shopId: string,
    quoteVersionId: string,
  ) {
    return transaction.quoteVersion.findFirst({
      where: { shopId, id: quoteVersionId },
      select: {
        id: true,
        status: true,
        repairOrderId: true,
        repairOrder: { select: { status: true } },
      },
    });
  }

  findDiagnosis(
    transaction: Prisma.TransactionClient,
    shopId: string,
    repairOrderId: string,
    diagnosisId: string,
  ) {
    return transaction.diagnosis.findFirst({
      where: { shopId, repairOrderId, id: diagnosisId },
      select: { id: true },
    });
  }

  async allocateVersion(
    transaction: Prisma.TransactionClient,
    shopId: string,
    repairOrderId: string,
  ): Promise<number> {
    const aggregate = await transaction.quoteVersion.aggregate({
      where: { shopId, repairOrderId },
      _max: { versionNo: true },
    });
    return (aggregate._max.versionNo ?? 0) + 1;
  }

  async createDraft(
    transaction: Prisma.TransactionClient,
    input: PersistDraftInput & {
      shopId: string;
      repairOrderId: string;
      versionNo: number;
      actorUserId: string;
      requestId: string;
    },
  ) {
    const quote = await transaction.quoteVersion.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        diagnosisId: input.diagnosisId,
        versionNo: input.versionNo,
        subtotal: input.calculation.subtotal,
        discount: input.calculation.discount,
        total: input.calculation.total,
        customerNote: input.customerNote,
        expiresAt: input.expiresAt,
        createdByUserId: input.actorUserId,
        items: {
          create: input.calculation.items.map((item, sortOrder) => ({
            kind: item.kind,
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity.toString()),
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            isOptional: item.isOptional,
            approvalGroup: item.approvalGroup,
            sortOrder,
          })),
        },
      },
      include: quoteInclude,
    });

    await this.createEvent(transaction, {
      shopId: input.shopId,
      repairOrderId: input.repairOrderId,
      quoteVersionId: quote.id,
      versionNo: quote.versionNo,
      eventType: "QUOTE_DRAFT_CREATED",
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      subtotal: input.calculation.subtotal,
      discount: input.calculation.discount,
      total: input.calculation.total,
    });
    return quote;
  }

  async replaceDraft(
    transaction: Prisma.TransactionClient,
    input: PersistDraftInput & {
      shopId: string;
      repairOrderId: string;
      quoteVersionId: string;
      actorUserId: string;
      requestId: string;
    },
  ) {
    const quote = await transaction.quoteVersion.update({
      where: { shopId_id: { shopId: input.shopId, id: input.quoteVersionId } },
      data: {
        diagnosisId: input.diagnosisId,
        subtotal: input.calculation.subtotal,
        discount: input.calculation.discount,
        total: input.calculation.total,
        customerNote: input.customerNote,
        expiresAt: input.expiresAt,
        items: {
          deleteMany: {},
          create: input.calculation.items.map((item, sortOrder) => ({
            kind: item.kind,
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity.toString()),
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            isOptional: item.isOptional,
            approvalGroup: item.approvalGroup,
            sortOrder,
          })),
        },
      },
      include: quoteInclude,
    });

    await this.createEvent(transaction, {
      shopId: input.shopId,
      repairOrderId: input.repairOrderId,
      quoteVersionId: quote.id,
      versionNo: quote.versionNo,
      eventType: "QUOTE_DRAFT_UPDATED",
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      subtotal: input.calculation.subtotal,
      discount: input.calculation.discount,
      total: input.calculation.total,
    });
    return quote;
  }

  private createEvent(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      quoteVersionId: string;
      versionNo: number;
      eventType: string;
      actorUserId: string;
      requestId: string;
      subtotal: bigint;
      discount: bigint;
      total: bigint;
    },
  ) {
    return transaction.orderEvent.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        eventType: input.eventType,
        actorType: ActorType.USER,
        actorUserId: input.actorUserId,
        publicPayload: Prisma.JsonNull,
        privatePayload: {
          quoteVersionId: input.quoteVersionId,
          versionNo: input.versionNo,
          subtotal: Number(input.subtotal),
          discount: Number(input.discount),
          total: Number(input.total),
        },
        requestId: input.requestId,
      },
    });
  }
}
