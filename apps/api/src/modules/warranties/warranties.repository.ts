import { Injectable } from "@nestjs/common";
import { MediaPurpose, MembershipRole, MembershipStatus, UserStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import type { TenantContext } from "../../common/tenant/tenant-context.js";

const warrantySourceSelect = {
  id: true,
  shopId: true,
  customerId: true,
  deviceId: true,
  status: true,
  completionOutcome: true,
  customerSnapshot: true,
  deviceSnapshot: true,
  customer: { select: { shopId: true } },
  device: { select: { shopId: true, customerId: true } },
  warranty: { select: { startsAt: true, endsAt: true, termsSnapshot: true } },
} satisfies Prisma.RepairOrderSelect;

export type WarrantySource = Prisma.RepairOrderGetPayload<{
  select: typeof warrantySourceSelect;
}>;

export interface WarrantyIntakeResources {
  shop: {
    orderCodePrefix: string;
    intakePhotoMinimum: number;
    timezone: string;
  } | null;
  branchExists: boolean;
  actorAuthorized: boolean;
  source: WarrantySource | null;
  media: Awaited<ReturnType<Prisma.TransactionClient["mediaAsset"]["findMany"]>>;
}

@Injectable()
export class WarrantiesRepository {
  async lockSource(
    transaction: Prisma.TransactionClient,
    tenant: Pick<TenantContext, "shopId">,
    sourceOrderId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM repair_orders
      WHERE "shopId" = ${tenant.shopId}::uuid AND id = ${sourceOrderId}::uuid
      FOR UPDATE
    `;
    return rows.length === 1;
  }

  async loadIntakeResources(
    transaction: Prisma.TransactionClient,
    tenant: Pick<TenantContext, "shopId">,
    input: {
      sourceOrderId: string;
      branchId: string;
      mediaAssetIds: string[];
      actorUserId: string;
    },
  ): Promise<WarrantyIntakeResources> {
    const [shop, branch, membership, source, media] = await Promise.all([
      transaction.shop.findUnique({
        where: { id: tenant.shopId },
        select: { orderCodePrefix: true, intakePhotoMinimum: true, timezone: true },
      }),
      transaction.branch.findFirst({
        where: { shopId: tenant.shopId, id: input.branchId, isActive: true },
        select: { id: true },
      }),
      transaction.shopMembership.findFirst({
        where: {
          shopId: tenant.shopId,
          userId: input.actorUserId,
          status: MembershipStatus.ACTIVE,
          role: { in: [MembershipRole.OWNER, MembershipRole.RECEPTIONIST] },
          user: { status: UserStatus.ACTIVE },
        },
        select: { userId: true },
      }),
      transaction.repairOrder.findFirst({
        where: { shopId: tenant.shopId, id: input.sourceOrderId },
        select: warrantySourceSelect,
      }),
      transaction.mediaAsset.findMany({
        where: {
          shopId: tenant.shopId,
          id: { in: input.mediaAssetIds },
          purpose: MediaPurpose.INTAKE,
          repairOrderId: null,
        },
      }),
    ]);
    return {
      shop,
      branchExists: Boolean(branch),
      actorAuthorized: Boolean(membership),
      source,
      media,
    };
  }
}
