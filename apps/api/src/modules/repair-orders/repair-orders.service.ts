/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { Priority, ServiceType } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { RepairOrderIntakeService } from "./repair-order-intake.service.js";
import type { CreateRepairOrderDto, ListRepairOrdersQueryDto } from "./repair-order.dto.js";
import {
  toRepairOrderDetailView,
  toRepairOrderView,
  type RepairOrderDetailResponse,
  type RepairOrderListResponse,
  type RepairOrderResponse,
} from "./repair-order.types.js";
import { type RepairOrderCursor, RepairOrdersRepository } from "./repair-orders.repository.js";

@Injectable()
export class RepairOrdersService {
  constructor(
    private readonly repository: RepairOrdersRepository,
    private readonly idempotency: IdempotencyService,
    private readonly intake: RepairOrderIntakeService,
  ) {}

  async list(
    tenant: TenantContext,
    query: ListRepairOrdersQueryDto,
  ): Promise<RepairOrderListResponse> {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const page = await this.repository.list(
      tenant,
      {
        query: query.query?.trim() || null,
        statuses: query.status?.length ? query.status : null,
        branchId: query.branchId?.toLowerCase() ?? null,
        technicianUserId: query.technicianUserId?.toLowerCase() ?? null,
      },
      cursor,
    );
    const last = page.orders.at(-1);
    return {
      data: page.orders.map(toRepairOrderView),
      meta: {
        nextCursor:
          page.hasMore && last
            ? this.encodeCursor({ id: last.id, updatedAt: last.updatedAt })
            : null,
      },
    };
  }

  async detail(tenant: TenantContext, repairOrderId: string): Promise<RepairOrderDetailResponse> {
    if (!this.isUuid(repairOrderId)) {
      throw this.notFound();
    }
    const order = await this.repository.detail(tenant, repairOrderId.toLowerCase());
    if (!order) {
      throw this.notFound();
    }
    return { data: toRepairOrderDetailView(order) };
  }

  create(
    tenant: TenantContext,
    dto: CreateRepairOrderDto,
    idempotencyKey: string | undefined,
  ): Promise<RepairOrderResponse> {
    const request = {
      branchId: dto.branchId.toLowerCase(),
      customerId: dto.customerId.toLowerCase(),
      deviceId: dto.deviceId.toLowerCase(),
      reportedProblem: dto.reportedProblem,
      intakeCondition: dto.intakeCondition,
      consentAcknowledged: dto.consentAcknowledged,
      priority: dto.priority ?? Priority.NORMAL,
      promisedAt: dto.promisedAt ?? null,
      accessories: (dto.accessories ?? []).map((item) => ({
        name: item.name,
        conditionNote: item.conditionNote ?? null,
      })),
      mediaAssetIds: [...dto.mediaAssetIds].sort(),
    };
    this.intake.rejectDeviceCredentials(request);

    return this.idempotency.execute({
      tenant,
      scope: "repair-orders.create",
      key: idempotencyKey,
      request,
      operation: async (transaction) => {
        const resources = await this.repository.loadIntakeResources(transaction, tenant, request);
        if (
          !resources.shop ||
          !resources.branchExists ||
          !resources.customer ||
          !resources.device
        ) {
          throw this.notFound();
        }
        await this.intake.verifyMedia(
          resources.media,
          request.mediaAssetIds.length,
          resources.shop.intakePhotoMinimum,
        );

        const now = new Date();
        const identity = await this.intake.allocateIdentity(
          transaction,
          tenant,
          resources.shop,
          now,
        );
        const order = await this.intake.create(transaction, tenant, {
          ...request,
          promisedAt: request.promisedAt ? new Date(request.promisedAt) : null,
          ...identity,
          serviceType: ServiceType.STANDARD,
          sourceOrderId: null,
          consentAcknowledgedAt: now,
          customerSnapshot: {
            id: resources.customer.id,
            name: resources.customer.name,
            phone: resources.customer.phoneRaw,
            email: resources.customer.email,
          },
          deviceSnapshot: {
            id: resources.device.id,
            type: resources.device.type,
            brand: resources.device.brand,
            model: resources.device.model,
            color: resources.device.color,
            serial: resources.device.serialNormalized,
            imei: resources.device.imeiNormalized,
          },
          actorUserId: tenant.userId,
          requestId: tenant.requestId,
          event: {
            eventType: "ORDER_CREATED",
            publicPayload: { code: identity.code, status: "RECEIVED" },
            privatePayload: {
              branchId: request.branchId,
              mediaCount: request.mediaAssetIds.length,
            },
          },
        });
        return { data: toRepairOrderView(order) };
      },
    });
  }

  private encodeCursor(cursor: RepairOrderCursor): string {
    return Buffer.from(
      JSON.stringify({ id: cursor.id, updatedAt: cursor.updatedAt.toISOString() }),
    ).toString("base64url");
  }

  private decodeCursor(value: string): RepairOrderCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
        id?: unknown;
        updatedAt?: unknown;
      };
      const updatedAt = typeof parsed.updatedAt === "string" ? new Date(parsed.updatedAt) : null;
      if (
        typeof parsed.id !== "string" ||
        !this.isUuid(parsed.id) ||
        !updatedAt ||
        Number.isNaN(updatedAt.getTime())
      ) {
        throw new Error("Invalid cursor");
      }
      return { id: parsed.id.toLowerCase(), updatedAt };
    } catch {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [{ field: "cursor", code: "INVALID_CURSOR", message: "cursor is invalid" }],
      );
    }
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
