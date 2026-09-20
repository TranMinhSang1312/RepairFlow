/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { MediaPurpose, MembershipRole, Prisma, type RepairOrderStatus } from "@prisma/client";

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

export interface RepairOrderCursor {
  id: string;
  updatedAt: Date;
}

export interface RepairOrderListFilters {
  query: string | null;
  statuses: RepairOrderStatus[] | null;
  branchId: string | null;
  technicianUserId: string | null;
}

const PAGE_SIZE = 25;

const repairOrderInclude = {
  customer: true,
  device: true,
  assignments: {
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
  },
} satisfies Prisma.RepairOrderInclude;

const repairOrderDetailInclude = {
  ...repairOrderInclude,
  accessories: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: { id: true, name: true, conditionNote: true },
  },
  media: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      purpose: true,
      originalName: true,
      mimeType: true,
      byteSize: true,
      uploadedAt: true,
    },
  },
  events: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      eventType: true,
      fromStatus: true,
      toStatus: true,
      actorType: true,
      publicPayload: true,
      createdAt: true,
    },
  },
} satisfies Prisma.RepairOrderInclude;

@Injectable()
export class RepairOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenant: TenantContext,
    filters: RepairOrderListFilters,
    cursor: RepairOrderCursor | null,
  ) {
    const technicianUserId =
      tenant.role === MembershipRole.TECHNICIAN ? tenant.userId : filters.technicianUserId;
    const cursorCondition: Prisma.RepairOrderWhereInput | undefined = cursor
      ? {
          OR: [
            { updatedAt: { lt: cursor.updatedAt } },
            { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
          ],
        }
      : undefined;
    const phoneQuery = filters.query ? this.normalizePhoneSearch(filters.query) : null;
    const identifierQuery = filters.query
      ? filters.query.toUpperCase().replace(/[^A-Z0-9]/g, "")
      : null;
    const queryPredicates: Prisma.RepairOrderWhereInput[] = filters.query
      ? [
          { code: { contains: filters.query, mode: "insensitive" } },
          { customer: { name: { contains: filters.query, mode: "insensitive" } } },
          { device: { model: { contains: filters.query, mode: "insensitive" } } },
        ]
      : [];
    if (phoneQuery) {
      queryPredicates.push({ customer: { phoneNormalized: { contains: phoneQuery } } });
    }
    if (identifierQuery) {
      queryPredicates.push({
        device: {
          OR: [
            { serialNormalized: { contains: identifierQuery, mode: "insensitive" } },
            { imeiNormalized: { contains: identifierQuery } },
          ],
        },
      });
    }

    const orders = await this.prisma.repairOrder.findMany({
      where: {
        shopId: tenant.shopId,
        ...(filters.statuses ? { status: { in: filters.statuses } } : {}),
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(technicianUserId
          ? { assignments: { some: { technicianUserId, unassignedAt: null } } }
          : {}),
        ...(cursorCondition ? { AND: [cursorCondition] } : {}),
        ...(queryPredicates.length > 0 ? { OR: queryPredicates } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      include: repairOrderInclude,
    });

    return { orders: orders.slice(0, PAGE_SIZE), hasMore: orders.length > PAGE_SIZE };
  }

  detail(tenant: TenantContext, repairOrderId: string) {
    return this.prisma.repairOrder.findFirst({
      where: {
        shopId: tenant.shopId,
        id: repairOrderId,
        ...(tenant.role === MembershipRole.TECHNICIAN
          ? { assignments: { some: { technicianUserId: tenant.userId, unassignedAt: null } } }
          : {}),
      },
      include: repairOrderDetailInclude,
    });
  }

  private normalizePhoneSearch(value: string): string | null {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 3) {
      return null;
    }
    if (digits.startsWith("00")) {
      return `+${digits.slice(2)}`;
    }
    if (digits.startsWith("0")) {
      return `+84${digits.slice(1)}`;
    }
    return value.startsWith("+") ? `+${digits}` : digits;
  }

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
