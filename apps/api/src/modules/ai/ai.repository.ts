/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { AiCapability, MembershipRole, Prisma } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";

@Injectable()
export class AiRepository {
  constructor(private readonly prisma: PrismaService) {}

  listSettings(shopId: string) {
    return this.prisma.aiCapabilitySetting.findMany({
      where: { shopId },
      orderBy: { capability: "asc" },
    });
  }

  async withTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(operation);
  }

  async lockSetting(
    transaction: Prisma.TransactionClient,
    shopId: string,
    capability: AiCapability,
  ) {
    const lockKey = `ai-setting:${shopId}:${capability}`;
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
    return transaction.aiCapabilitySetting.findUnique({
      where: { shopId_capability: { shopId, capability } },
    });
  }

  findRunForActor(
    shopId: string,
    runId: string,
    role: MembershipRole,
    userId: string,
    transaction: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return transaction.aiRun.findFirst({
      where: {
        shopId,
        id: runId,
        ...(role === MembershipRole.TECHNICIAN
          ? {
              repairOrderId: { not: null },
              repairOrder: {
                assignments: { some: { technicianUserId: userId, unassignedAt: null } },
              },
            }
          : {}),
      },
    });
  }
}
