/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime. */

import { Injectable } from "@nestjs/common";
import { MembershipRole, type Prisma } from "@prisma/client";

import type { TenantContext } from "../../../../common/tenant/tenant-context.js";
import { PrismaService } from "../../../../infra/database/prisma.service.js";

@Injectable()
export class DeviceOcrRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMediaForActor(tenant: TenantContext, mediaAssetId: string) {
    return this.prisma.mediaAsset.findFirst({
      where: {
        shopId: tenant.shopId,
        id: mediaAssetId,
        ...(tenant.role === MembershipRole.TECHNICIAN
          ? {
              repairOrderId: { not: null },
              repairOrder: {
                assignments: {
                  some: { technicianUserId: tenant.userId, unassignedAt: null },
                },
              },
            }
          : {}),
      },
    });
  }

  findMedia(
    shopId: string,
    mediaAssetId: string,
    transaction: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return transaction.mediaAsset.findFirst({ where: { shopId, id: mediaAssetId } });
  }
}
