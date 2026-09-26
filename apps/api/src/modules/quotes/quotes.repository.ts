/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { ActorType, NotificationStatus, Prisma, QuoteStatus, TokenScope } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";
import type { QuoteCalculation } from "./quote-calculator.js";
import type { NotificationPlan } from "../notifications/fake-notification.adapter.js";
import type { QuoteTokenMetadata } from "../public-access/public-token.service.js";

const quoteInclude = {
  items: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.QuoteVersionInclude;

interface PersistDraftInput {
  diagnosisId: string | null;
  calculation: QuoteCalculation;
  customerNote: string | null;
  expiresAt: Date | null;
}

const bindingApprovalInclude = {
  items: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
  approval: { select: { approvedItemSnapshot: true } },
} satisfies Prisma.QuoteVersionInclude;

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

  findQuoteForSend(transaction: Prisma.TransactionClient, shopId: string, quoteVersionId: string) {
    return transaction.quoteVersion.findFirst({
      where: { shopId, id: quoteVersionId },
      include: {
        ...quoteInclude,
        repairOrder: {
          select: {
            id: true,
            status: true,
            lockVersion: true,
            customerSnapshot: true,
            shop: { select: { defaultQuoteExpiryHours: true } },
          },
        },
      },
    });
  }

  findBindingApproval(
    transaction: Prisma.TransactionClient,
    shopId: string,
    repairOrderId: string,
  ) {
    return transaction.quoteVersion.findFirst({
      where: {
        shopId,
        repairOrderId,
        status: { in: [QuoteStatus.ACCEPTED, QuoteStatus.PARTIALLY_ACCEPTED] },
        approval: { isNot: null },
      },
      orderBy: [{ versionNo: "desc" }, { id: "desc" }],
      include: bindingApprovalInclude,
    });
  }

  async countExecutionReferences(
    transaction: Prisma.TransactionClient,
    shopId: string,
    quoteItemIds: string[],
  ): Promise<number> {
    if (quoteItemIds.length === 0) return 0;
    const [work, parts] = await Promise.all([
      transaction.workLog.count({ where: { shopId, quoteItemId: { in: quoteItemIds } } }),
      transaction.partUsed.count({ where: { shopId, quoteItemId: { in: quoteItemIds } } }),
    ]);
    return work + parts;
  }

  appendLineageAudit(input: {
    shopId: string;
    actorUserId: string | null;
    entityId: string;
    requestId: string;
    accepted: boolean;
    reason: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        shopId: input.shopId,
        actorUserId: input.actorUserId,
        action: input.accepted ? "QUOTE_SCOPE_LINEAGE_ACCEPTED" : "QUOTE_SCOPE_LINEAGE_REJECTED",
        entityType: "REPAIR_ORDER",
        entityId: input.entityId,
        beforeData: Prisma.JsonNull,
        afterData: { accepted: input.accepted, reason: input.reason },
        requestId: input.requestId,
      },
    });
  }

  appendLineageAuditInTransaction(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      actorUserId: string | null;
      entityId: string;
      requestId: string;
      reason: string;
    },
  ) {
    return transaction.auditLog.create({
      data: {
        shopId: input.shopId,
        actorUserId: input.actorUserId,
        action: "QUOTE_SCOPE_LINEAGE_ACCEPTED",
        entityType: "REPAIR_ORDER",
        entityId: input.entityId,
        beforeData: Prisma.JsonNull,
        afterData: { accepted: true, reason: input.reason },
        requestId: input.requestId,
      },
    });
  }

  findActiveSentQuotes(
    transaction: Prisma.TransactionClient,
    shopId: string,
    repairOrderId: string,
    exceptQuoteVersionId: string,
  ) {
    return transaction.quoteVersion.findMany({
      where: {
        shopId,
        repairOrderId,
        id: { not: exceptQuoteVersionId },
        status: QuoteStatus.SENT,
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
  }

  async supersedeQuotes(
    transaction: Prisma.TransactionClient,
    shopId: string,
    quoteVersionIds: string[],
    revokedAt: Date,
  ): Promise<void> {
    if (quoteVersionIds.length === 0) return;
    await transaction.quoteVersion.updateMany({
      where: { shopId, id: { in: quoteVersionIds }, status: QuoteStatus.SENT },
      data: { status: QuoteStatus.SUPERSEDED },
    });
    await transaction.publicAccessToken.updateMany({
      where: {
        shopId,
        quoteVersionId: { in: quoteVersionIds },
        scope: TokenScope.DECIDE_QUOTE,
        revokedAt: null,
      },
      data: { revokedAt },
    });
  }

  markSent(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      quoteVersionId: string;
      sentAt: Date;
      expiresAt: Date;
    },
  ) {
    return transaction.quoteVersion.update({
      where: { shopId_id: { shopId: input.shopId, id: input.quoteVersionId } },
      data: {
        status: QuoteStatus.SENT,
        sentAt: input.sentAt,
        expiresAt: input.expiresAt,
      },
      include: quoteInclude,
    });
  }

  createPublicToken(
    transaction: Prisma.TransactionClient,
    metadata: QuoteTokenMetadata,
    tokenHash: string,
  ) {
    return transaction.publicAccessToken.create({
      data: {
        id: metadata.tokenId,
        shopId: metadata.shopId,
        repairOrderId: metadata.repairOrderId,
        quoteVersionId: metadata.quoteVersionId,
        scope: TokenScope.DECIDE_QUOTE,
        tokenHash,
        expiresAt: new Date(metadata.expiresAt),
      },
    });
  }

  async appendSendArtifacts(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      quoteVersionId: string;
      versionNo: number;
      tokenId: string;
      tokenExpiresAt: string;
      channel: string;
      notification: NotificationPlan | null;
      actorUserId: string;
      requestId: string;
    },
  ): Promise<void> {
    await transaction.orderEvent.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        eventType: "QUOTE_SENT",
        actorType: ActorType.USER,
        actorUserId: input.actorUserId,
        publicPayload: { quoteVersion: input.versionNo },
        privatePayload: {
          quoteVersionId: input.quoteVersionId,
          tokenRecordId: input.tokenId,
          channel: input.channel,
          expiresAt: input.tokenExpiresAt,
        },
        requestId: input.requestId,
      },
    });

    await transaction.outboxEvent.create({
      data: {
        shopId: input.shopId,
        eventType: "QUOTE_SENT",
        aggregateType: "QUOTE_VERSION",
        aggregateId: input.quoteVersionId,
        payload: {
          repairOrderId: input.repairOrderId,
          quoteVersionId: input.quoteVersionId,
          tokenRecordId: input.tokenId,
          tokenScope: TokenScope.DECIDE_QUOTE,
          channel: input.channel,
          templateKey: "QUOTE_SENT_V1",
          expiresAt: input.tokenExpiresAt,
        },
        ...(input.notification
          ? {
              notifications: {
                create: {
                  channel: input.notification.channel,
                  destinationHash: input.notification.destinationHash,
                  status: NotificationStatus.PENDING,
                },
              },
            }
          : {}),
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
            displayNote: item.displayNote,
            carriedFromQuoteItemId: item.carriedFromQuoteItemId,
            ...(item.scopeKey ? { scopeKey: item.scopeKey } : {}),
            quantity: new Prisma.Decimal(item.quantity.toString()),
            quantityUnit: item.quantityUnit,
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
            displayNote: item.displayNote,
            carriedFromQuoteItemId: item.carriedFromQuoteItemId,
            ...(item.scopeKey ? { scopeKey: item.scopeKey } : {}),
            quantity: new Prisma.Decimal(item.quantity.toString()),
            quantityUnit: item.quantityUnit,
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
