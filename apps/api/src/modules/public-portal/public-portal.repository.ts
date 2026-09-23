/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { ActorType, Prisma, QuoteStatus, type QuoteDecision } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";

const publicTokenInclude = {
  repairOrder: {
    select: {
      id: true,
      code: true,
      status: true,
      completionOutcome: true,
      lockVersion: true,
      deviceSnapshot: true,
      shop: { select: { name: true, contactPhone: true } },
      events: {
        where: { publicPayload: { not: Prisma.JsonNull } },
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
        select: { eventType: true, publicPayload: true, createdAt: true },
      },
    },
  },
  quoteVersion: {
    include: {
      items: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
      approval: { select: { id: true, decision: true, decidedAt: true } },
    },
  },
} satisfies Prisma.PublicAccessTokenInclude;

export type PublicTokenRecord = Prisma.PublicAccessTokenGetPayload<{
  include: typeof publicTokenInclude;
}>;

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PublicPortalRepository {
  constructor(private readonly prisma: PrismaService) {}

  withTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(operation);
  }

  findToken(db: DbClient, tokenHash: string): Promise<PublicTokenRecord | null> {
    return db.publicAccessToken.findUnique({
      where: { tokenHash },
      include: publicTokenInclude,
    });
  }

  findTokenCurrent(tokenHash: string): Promise<PublicTokenRecord | null> {
    return this.findToken(this.prisma, tokenHash);
  }

  lock(transaction: Prisma.TransactionClient, shopId: string, repairOrderId: string) {
    return transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${shopId}:${repairOrderId}`}, 0)
      )::text AS locked
    `;
  }

  touchToken(db: DbClient, tokenId: string, usedAt: Date) {
    return db.publicAccessToken.update({ where: { id: tokenId }, data: { lastUsedAt: usedAt } });
  }

  async updateQuoteDecision(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      quoteVersionId: string;
      status: QuoteStatus;
      decidedAt: Date;
    },
  ): Promise<boolean> {
    const result = await transaction.quoteVersion.updateMany({
      where: {
        shopId: input.shopId,
        id: input.quoteVersionId,
        status: QuoteStatus.SENT,
        decidedAt: null,
      },
      data: { status: input.status, decidedAt: input.decidedAt },
    });
    return result.count === 1;
  }

  createApproval(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      quoteVersionId: string;
      decision: QuoteDecision;
      approvedItemSnapshot: Prisma.InputJsonValue;
      approvedTotal: bigint;
      customerNote: string | null;
      actorFingerprint: string;
      idempotencyKeyHash: string;
      decidedAt: Date;
    },
  ) {
    return transaction.quoteApproval.create({ data: input });
  }

  async appendDecisionArtifacts(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      quoteVersionId: string;
      decision: QuoteDecision;
      approvedTotal: bigint;
      decidedAt: Date;
      requestId: string;
    },
  ): Promise<void> {
    await transaction.orderEvent.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        eventType: "QUOTE_DECIDED",
        actorType: ActorType.CUSTOMER_TOKEN,
        actorUserId: null,
        publicPayload: {
          message:
            input.decision === "DECLINED" ? "The quote was declined." : "The quote was approved.",
          decision: input.decision,
        },
        privatePayload: {
          quoteVersionId: input.quoteVersionId,
          approvedTotal: Number(input.approvedTotal),
        },
        requestId: input.requestId,
        createdAt: input.decidedAt,
      },
    });

    await transaction.outboxEvent.create({
      data: {
        shopId: input.shopId,
        eventType: "QUOTE_DECIDED",
        aggregateType: "QUOTE_VERSION",
        aggregateId: input.quoteVersionId,
        payload: {
          repairOrderId: input.repairOrderId,
          quoteVersionId: input.quoteVersionId,
          decision: input.decision,
          approvedTotal: Number(input.approvedTotal),
          decidedAt: input.decidedAt.toISOString(),
        },
      },
    });
  }
}
