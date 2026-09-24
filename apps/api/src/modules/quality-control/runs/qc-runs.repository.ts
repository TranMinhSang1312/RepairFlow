/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import {
  ActorType,
  MediaPurpose,
  Prisma,
  type QcItemResult,
  type QcRunResult,
} from "@prisma/client";

import { PrismaService } from "../../../infra/database/prisma.service.js";
import { qcRunInclude } from "./qc-run.types.js";

@Injectable()
export class QcRunsRepository {
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
      select: {
        id: true,
        status: true,
        lockVersion: true,
        assignments: {
          where: { unassignedAt: null },
          orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { technicianUserId: true },
        },
      },
    });
  }

  findTemplate(transaction: Prisma.TransactionClient, shopId: string, qcTemplateId: string) {
    return transaction.qcTemplate.findFirst({
      where: { shopId, id: qcTemplateId },
      include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
  }

  findEvidence(transaction: Prisma.TransactionClient, shopId: string, mediaAssetIds: string[]) {
    return transaction.mediaAsset.findMany({
      where: { shopId, id: { in: mediaAssetIds } },
    });
  }

  async allocateRunNo(
    transaction: Prisma.TransactionClient,
    shopId: string,
    repairOrderId: string,
  ): Promise<number> {
    const aggregate = await transaction.qcRun.aggregate({
      where: { shopId, repairOrderId },
      _max: { runNo: true },
    });
    return (aggregate._max.runNo ?? 0) + 1;
  }

  finalizeEvidence(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      mediaAssetIds: string[];
      now: Date;
    },
  ) {
    return transaction.mediaAsset.updateMany({
      where: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        id: { in: input.mediaAssetIds },
        purpose: MediaPurpose.QC,
        uploadedAt: null,
        expiresAt: { gt: input.now },
      },
      data: { uploadedAt: input.now, expiresAt: null },
    });
  }

  createRun(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      qcTemplateId: string;
      runNo: number;
      result: QcRunResult;
      notes: string | null;
      actorUserId: string;
      results: Array<{
        qcTemplateItemId: string;
        result: QcItemResult;
        note: string | null;
        evidenceMediaAssetIds: string[];
      }>;
    },
  ) {
    return transaction.qcRun.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        qcTemplateId: input.qcTemplateId,
        runNo: input.runNo,
        result: input.result,
        notes: input.notes,
        checkedByUserId: input.actorUserId,
        results: {
          create: input.results.map((result) => ({
            qcTemplateItemId: result.qcTemplateItemId,
            result: result.result,
            note: result.note,
            evidence: {
              create: result.evidenceMediaAssetIds.map((mediaAssetId) => ({
                mediaAssetId,
              })),
            },
          })),
        },
      },
      include: qcRunInclude,
    });
  }

  appendCompletedEvent(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      repairOrderId: string;
      qcRunId: string;
      qcTemplateId: string;
      templateVersionNo: number;
      runNo: number;
      result: QcRunResult;
      evidenceCount: number;
      actorUserId: string;
      requestId: string;
    },
  ) {
    return transaction.orderEvent.create({
      data: {
        shopId: input.shopId,
        repairOrderId: input.repairOrderId,
        eventType: "QC_COMPLETED",
        actorType: ActorType.USER,
        actorUserId: input.actorUserId,
        publicPayload: {
          message:
            input.result === "PASS"
              ? "Quality control was completed."
              : "Additional repair work is required after quality control.",
        },
        privatePayload: {
          qcRunId: input.qcRunId,
          qcTemplateId: input.qcTemplateId,
          templateVersionNo: input.templateVersionNo,
          runNo: input.runNo,
          result: input.result,
          evidenceCount: input.evidenceCount,
        },
        requestId: input.requestId,
      },
    });
  }
}
