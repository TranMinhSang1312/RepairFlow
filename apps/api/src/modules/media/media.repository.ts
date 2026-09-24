/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import { MembershipRole, type MediaAsset, type MediaPurpose } from "@prisma/client";

import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { tenantWhere } from "../../common/tenant/tenant-where.js";
import { PrismaService } from "../../infra/database/prisma.service.js";

interface CreateMediaAssetData {
  purpose: MediaPurpose;
  objectKey: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string | null;
  uploadedByUserId: string;
  expiresAt: Date;
}

@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  createProvisional(
    tenant: Pick<TenantContext, "shopId">,
    data: CreateMediaAssetData,
  ): Promise<MediaAsset> {
    return this.prisma.mediaAsset.create({ data: { shopId: tenant.shopId, ...data } });
  }

  findVisibleOrder(tenant: TenantContext, repairOrderId: string) {
    return this.prisma.repairOrder.findFirst({
      where: {
        shopId: tenant.shopId,
        id: repairOrderId,
        ...(tenant.role === MembershipRole.TECHNICIAN
          ? { assignments: { some: { technicianUserId: tenant.userId, unassignedAt: null } } }
          : {}),
      },
      select: { id: true },
    });
  }

  createOrderProvisional(
    tenant: Pick<TenantContext, "shopId">,
    repairOrderId: string,
    data: CreateMediaAssetData,
  ): Promise<MediaAsset> {
    return this.prisma.mediaAsset.create({
      data: { shopId: tenant.shopId, repairOrderId, ...data },
    });
  }

  async deleteProvisional(
    tenant: Pick<TenantContext, "shopId">,
    mediaAssetId: string,
  ): Promise<void> {
    await this.prisma.mediaAsset.deleteMany({
      where: tenantWhere(tenant, { id: mediaAssetId, repairOrderId: null, uploadedAt: null }),
    });
  }

  async deleteOrderProvisional(
    tenant: Pick<TenantContext, "shopId">,
    repairOrderId: string,
    mediaAssetId: string,
  ): Promise<void> {
    await this.prisma.mediaAsset.deleteMany({
      where: tenantWhere(tenant, {
        id: mediaAssetId,
        repairOrderId,
        uploadedAt: null,
      }),
    });
  }
}
