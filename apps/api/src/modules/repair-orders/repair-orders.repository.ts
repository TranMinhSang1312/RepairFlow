/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { MediaPurpose, Prisma } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { PrismaService } from "../../infra/database/prisma.service.js";

export interface IntakeResources {
  shop: {
    orderCodePrefix: string;
    intakePhotoMinimum: number;
    timezone: string;
  } | null;
  branchExists: boolean;
  customer: Awaited<ReturnType<Prisma.TransactionClient["customer"]["findFirst"]>>;
  device: Awaited<ReturnType<Prisma.TransactionClient["device"]["findFirst"]>>;
  media: Awaited<ReturnType<Prisma.TransactionClient["mediaAsset"]["findMany"]>>;
}

export interface CreateOrderData {
  branchId: string;
  customerId: string;
  deviceId: string;
  orderNo: number;
  code: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  reportedProblem: string;
  intakeCondition: string;
  promisedAt: Date | null;
  consentAcknowledgedAt: Date;
  customerSnapshot: Prisma.InputJsonValue;
  deviceSnapshot: Prisma.InputJsonValue;
  accessories: Array<{ name: string; conditionNote: string | null }>;
  mediaAssetIds: string[];
  actorUserId: string;
  requestId: string;
}

@Injectable()
export class RepairOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadIntakeResources(
    transaction: Prisma.TransactionClient,
    tenant: Pick<TenantContext, "shopId">,
    input: { branchId: string; customerId: string; deviceId: string; mediaAssetIds: string[] },
  ): Promise<IntakeResources> {
    const [shop, branch, customer, device, media] = await Promise.all([
      transaction.shop.findUnique({
        where: { id: tenant.shopId },
        select: { orderCodePrefix: true, intakePhotoMinimum: true, timezone: true },
      }),
      transaction.branch.findFirst({
        where: { shopId: tenant.shopId, id: input.branchId, isActive: true },
        select: { id: true },
      }),
      transaction.customer.findFirst({
        where: { shopId: tenant.shopId, id: input.customerId, archivedAt: null },
      }),
      transaction.device.findFirst({
        where: {
          shopId: tenant.shopId,
          id: input.deviceId,
          customerId: input.customerId,
          archivedAt: null,
        },
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

    return { shop, branchExists: Boolean(branch), customer, device, media };
  }

  async allocateOrderNumber(
    transaction: Prisma.TransactionClient,
    tenant: Pick<TenantContext, "shopId">,
  ): Promise<number> {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenant.shopId}))::text AS locked`;
    const result = await transaction.repairOrder.aggregate({
      where: { shopId: tenant.shopId },
      _max: { orderNo: true },
    });
    return (result._max.orderNo ?? 0) + 1;
  }

  async create(
    transaction: Prisma.TransactionClient,
    tenant: Pick<TenantContext, "shopId">,
    data: CreateOrderData,
  ) {
    const order = await transaction.repairOrder.create({
      data: {
        shopId: tenant.shopId,
        branchId: data.branchId,
        customerId: data.customerId,
        deviceId: data.deviceId,
        orderNo: data.orderNo,
        code: data.code,
        priority: data.priority,
        reportedProblem: data.reportedProblem,
        intakeCondition: data.intakeCondition,
        promisedAt: data.promisedAt,
        consentAcknowledgedAt: data.consentAcknowledgedAt,
        customerSnapshot: data.customerSnapshot,
        deviceSnapshot: data.deviceSnapshot,
        createdByUserId: data.actorUserId,
      },
      include: { customer: true, device: true },
    });

    if (data.accessories.length > 0) {
      await transaction.intakeAccessory.createMany({
        data: data.accessories.map((accessory) => ({
          shopId: tenant.shopId,
          repairOrderId: order.id,
          ...accessory,
        })),
      });
    }

    const mediaBinding = await transaction.mediaAsset.updateMany({
      where: {
        shopId: tenant.shopId,
        id: { in: data.mediaAssetIds },
        purpose: MediaPurpose.INTAKE,
        repairOrderId: null,
      },
      data: { repairOrderId: order.id, uploadedAt: data.consentAcknowledgedAt, expiresAt: null },
    });
    if (mediaBinding.count !== data.mediaAssetIds.length) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "MEDIA_UPLOAD_INCOMPLETE",
        "One or more intake uploads are no longer available.",
      );
    }

    await transaction.orderEvent.create({
      data: {
        shopId: tenant.shopId,
        repairOrderId: order.id,
        eventType: "ORDER_CREATED",
        toStatus: "RECEIVED",
        actorType: "USER",
        actorUserId: data.actorUserId,
        publicPayload: { code: data.code, status: "RECEIVED" },
        privatePayload: { branchId: data.branchId, mediaCount: data.mediaAssetIds.length },
        requestId: data.requestId,
      },
    });

    return order;
  }
}
