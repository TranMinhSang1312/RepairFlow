/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import {
  ActorType,
  MediaPurpose,
  Prisma,
  QuoteStatus,
  TokenScope,
  type CompletionOutcome,
  type PaymentDisposition,
  type PaymentMethod,
} from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";
import type { TrackTokenMetadata } from "../public-access/public-token.service.js";

const activeAssignment = {
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
} satisfies Prisma.AssignmentFindManyArgs;

const handoverOrderInclude = {
  customer: true,
  device: true,
  assignments: activeAssignment,
  handover: true,
  warranty: true,
  payments: {
    orderBy: [{ receivedAt: "asc" as const }, { id: "asc" as const }],
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
      approval: { select: { approvedTotal: true } },
    },
  },
} satisfies Prisma.RepairOrderInclude;

export type HandoverOrderRecord = Prisma.RepairOrderGetPayload<{
  include: typeof handoverOrderInclude;
}>;

@Injectable()
export class HandoversRepository {
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
      include: handoverOrderInclude,
    });
  }

  findMedia(transaction: Prisma.TransactionClient, shopId: string, mediaAssetId: string) {
    return transaction.mediaAsset.findFirst({ where: { shopId, id: mediaAssetId } });
  }

  finalizeMedia(
    transaction: Prisma.TransactionClient,
    input: { shopId: string; repairOrderId: string; mediaAssetId: string; now: Date },
  ) {
    return transaction.mediaAsset.updateMany({
      where: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        id: input.mediaAssetId,
        purpose: { in: [MediaPurpose.SIGNATURE, MediaPurpose.HANDOVER] },
        uploadedAt: null,
        expiresAt: { gt: input.now },
      },
      data: { uploadedAt: input.now, expiresAt: null },
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

  createHandover(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      recipientName: string;
      paymentDisposition: PaymentDisposition;
      paymentNote: string | null;
      signatureMediaAssetId: string | null;
      actorUserId: string;
      handedOverAt: Date;
    },
  ) {
    return transaction.handover.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        recipientName: input.recipientName,
        paymentDisposition: input.paymentDisposition,
        paymentNote: input.paymentNote,
        signatureMediaAssetId: input.signatureMediaAssetId,
        handedOverByUserId: input.actorUserId,
        handedOverAt: input.handedOverAt,
      },
    });
  }

  createWarranty(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      startsAt: Date;
      endsAt: Date;
      terms: string;
    },
  ) {
    return transaction.warranty.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        termsSnapshot: input.terms,
      },
    });
  }

  revokePublicTokens(
    transaction: Prisma.TransactionClient,
    input: { shopId: string; repairOrderId: string; revokedAt: Date },
  ) {
    return transaction.publicAccessToken.updateMany({
      where: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        scope: { in: [TokenScope.DECIDE_QUOTE, TokenScope.TRACK_ORDER] },
        revokedAt: null,
      },
      data: { revokedAt: input.revokedAt },
    });
  }

  createTrackToken(
    transaction: Prisma.TransactionClient,
    metadata: TrackTokenMetadata,
    tokenHash: string,
  ) {
    return transaction.publicAccessToken.create({
      data: {
        id: metadata.tokenId,
        shopId: metadata.shopId,
        repairOrderId: metadata.repairOrderId,
        quoteVersionId: null,
        scope: TokenScope.TRACK_ORDER,
        tokenHash,
        expiresAt: new Date(metadata.expiresAt),
      },
    });
  }

  findTrackToken(transaction: Prisma.TransactionClient, tokenId: string) {
    return transaction.publicAccessToken.findUnique({
      where: { id: tokenId },
      select: {
        id: true,
        shopId: true,
        repairOrderId: true,
        scope: true,
        tokenHash: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }

  async appendCompletionArtifacts(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      completionOutcome: CompletionOutcome;
      actorUserId: string;
      requestId: string;
      handedOverAt: Date;
      warrantyEndsAt: Date | null;
      paymentRecorded: boolean;
    },
  ): Promise<void> {
    if (input.paymentRecorded) {
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
          createdAt: input.handedOverAt,
        },
      });
    }
    await transaction.orderEvent.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        eventType: "HANDOVER_COMPLETED",
        actorType: ActorType.USER,
        actorUserId: input.actorUserId,
        publicPayload: {
          message: "The device was handed over.",
          status: "COMPLETED",
          completionOutcome: input.completionOutcome,
        },
        privatePayload: {
          completed: true,
          warrantyCreated: input.warrantyEndsAt !== null,
        },
        requestId: input.requestId,
        createdAt: input.handedOverAt,
      },
    });
    if (input.warrantyEndsAt) {
      await transaction.orderEvent.create({
        data: {
          shopId: input.shopId,
          repairOrderId: input.repairOrderId,
          eventType: "WARRANTY_STARTED",
          actorType: ActorType.USER,
          actorUserId: input.actorUserId,
          publicPayload: {
            message: "Warranty coverage started.",
            endsAt: input.warrantyEndsAt.toISOString(),
          },
          privatePayload: { warrantyCreated: true },
          requestId: input.requestId,
          createdAt: input.handedOverAt,
        },
      });
    }
    await transaction.auditLog.create({
      data: {
        shopId: input.shopId,
        actorUserId: input.actorUserId,
        action: "HANDOVER_COMPLETED",
        entityType: "REPAIR_ORDER",
        entityId: input.repairOrderId,
        beforeData: Prisma.JsonNull,
        afterData: {
          completed: true,
          warrantyCreated: input.warrantyEndsAt !== null,
          paymentRecorded: input.paymentRecorded,
        },
        requestId: input.requestId,
        createdAt: input.handedOverAt,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        shopId: input.shopId,
        eventType: "REPAIR_ORDER_COMPLETED",
        aggregateType: "REPAIR_ORDER",
        aggregateId: input.repairOrderId,
        payload: {
          repairOrderId: input.repairOrderId,
          status: "COMPLETED",
          completionOutcome: input.completionOutcome,
          handedOverAt: input.handedOverAt.toISOString(),
          hasWarranty: input.warrantyEndsAt !== null,
        },
      },
    });
  }

  loadCompletedAggregate(shopId: string, repairOrderId: string) {
    return this.prisma.repairOrder.findFirst({
      where: { shopId, id: repairOrderId },
      include: handoverOrderInclude,
    });
  }
}
