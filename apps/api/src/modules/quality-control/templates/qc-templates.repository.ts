/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../infra/database/prisma.service.js";
import { qcTemplateInclude } from "./qc-template.types.js";

@Injectable()
export class QcTemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(shopId: string, includeInactive: boolean) {
    return this.prisma.qcTemplate.findMany({
      where: { shopId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ normalizedName: "asc" }, { versionNo: "desc" }, { id: "asc" }],
      include: qcTemplateInclude,
    });
  }

  lockFamily(transaction: Prisma.TransactionClient, shopId: string, normalizedName: string) {
    return transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`qc-template:${shopId}:${normalizedName}`}, 0)
      )::text AS locked
    `;
  }

  findById(transaction: Prisma.TransactionClient, shopId: string, id: string) {
    return transaction.qcTemplate.findFirst({
      where: { shopId, id },
      include: qcTemplateInclude,
    });
  }

  findActive(transaction: Prisma.TransactionClient, shopId: string, normalizedName: string) {
    return transaction.qcTemplate.findFirst({
      where: { shopId, normalizedName, isActive: true },
      include: qcTemplateInclude,
    });
  }

  async allocateVersion(
    transaction: Prisma.TransactionClient,
    shopId: string,
    normalizedName: string,
  ): Promise<number> {
    const aggregate = await transaction.qcTemplate.aggregate({
      where: { shopId, normalizedName },
      _max: { versionNo: true },
    });
    return (aggregate._max.versionNo ?? 0) + 1;
  }

  deactivateFamily(transaction: Prisma.TransactionClient, shopId: string, normalizedName: string) {
    return transaction.qcTemplate.updateMany({
      where: { shopId, normalizedName, isActive: true },
      data: { isActive: false },
    });
  }

  createVersion(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      name: string;
      normalizedName: string;
      versionNo: number;
      items: Array<{
        label: string;
        isRequired: boolean;
        allowNa: boolean;
        sortOrder: number;
      }>;
    },
  ) {
    return transaction.qcTemplate.create({
      data: {
        shopId: input.shopId,
        name: input.name,
        normalizedName: input.normalizedName,
        versionNo: input.versionNo,
        items: { create: input.items },
      },
      include: qcTemplateInclude,
    });
  }

  deactivateById(transaction: Prisma.TransactionClient, shopId: string, id: string) {
    return transaction.qcTemplate.update({
      where: { shopId_id: { shopId, id } },
      data: { isActive: false },
      include: qcTemplateInclude,
    });
  }

  appendAudit(
    transaction: Prisma.TransactionClient,
    input: {
      shopId: string;
      actorUserId: string;
      action: "QC_TEMPLATE_PUBLISHED" | "QC_TEMPLATE_DEACTIVATED";
      entityId: string;
      requestId: string;
      beforeData: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      afterData: Prisma.InputJsonValue;
    },
  ) {
    return transaction.auditLog.create({
      data: {
        shopId: input.shopId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: "QC_TEMPLATE",
        entityId: input.entityId,
        beforeData: input.beforeData,
        afterData: input.afterData,
        requestId: input.requestId,
      },
    });
  }
}
