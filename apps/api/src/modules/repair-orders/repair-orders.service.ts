/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { Priority } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { MediaUploadVerifier } from "../media/media-upload-verifier.service.js";
import type { CreateRepairOrderDto, ListRepairOrdersQueryDto } from "./repair-order.dto.js";
import {
  toRepairOrderDetailView,
  toRepairOrderView,
  type RepairOrderDetailResponse,
  type RepairOrderListResponse,
  type RepairOrderResponse,
} from "./repair-order.types.js";
import { type RepairOrderCursor, RepairOrdersRepository } from "./repair-orders.repository.js";

const DEVICE_CREDENTIAL_PATTERN =
  /(?:pin|password|passcode|unlock(?:\s+code)?|mật khẩu|mat khau)\s*[:#=-]\s*\S+/iu;

@Injectable()
export class RepairOrdersService {
  constructor(
    private readonly repository: RepairOrdersRepository,
    private readonly idempotency: IdempotencyService,
    private readonly mediaVerifier: MediaUploadVerifier,
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
    this.rejectDeviceCredentials(dto);
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
        if (resources.media.length !== request.mediaAssetIds.length) {
          throw this.notFound();
        }
        if (resources.media.length < resources.shop.intakePhotoMinimum) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "INTAKE_PHOTOS_REQUIRED",
            "The configured intake photo minimum has not been met.",
          );
        }

        let complete: boolean[];
        try {
          complete = await Promise.all(
            resources.media.map((asset) => this.mediaVerifier.isComplete(asset)),
          );
        } catch {
          throw new ApiException(
            HttpStatus.SERVICE_UNAVAILABLE,
            "STORAGE_UNAVAILABLE",
            "Private object storage is temporarily unavailable.",
          );
        }
        if (complete.some((value) => !value)) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "MEDIA_UPLOAD_INCOMPLETE",
            "One or more intake uploads are incomplete or expired.",
          );
        }

        const now = new Date();
        const orderNo = await this.repository.allocateOrderNumber(transaction, tenant);
        const code = this.formatOrderCode(
          resources.shop.orderCodePrefix,
          resources.shop.timezone,
          orderNo,
          now,
        );
        const order = await this.repository.create(transaction, tenant, {
          ...request,
          promisedAt: request.promisedAt ? new Date(request.promisedAt) : null,
          orderNo,
          code,
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
        });
        return { data: toRepairOrderView(order) };
      },
    });
  }

  private formatOrderCode(prefix: string, timezone: string, orderNo: number, now: Date): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "2-digit",
      month: "2-digit",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value ?? "00";
    const month = parts.find((part) => part.type === "month")?.value ?? "00";
    return `${prefix}-${year}${month}-${String(orderNo).padStart(5, "0")}`;
  }

  private rejectDeviceCredentials(dto: CreateRepairOrderDto): void {
    const fields = [
      ["reportedProblem", dto.reportedProblem],
      ["intakeCondition", dto.intakeCondition],
      ...(dto.accessories ?? []).flatMap((item, index) => [
        [`accessories.${index}.name`, item.name],
        [`accessories.${index}.conditionNote`, item.conditionNote],
      ]),
    ] as Array<[string, string | null | undefined]>;
    const prohibited = fields.find(([, value]) => value && DEVICE_CREDENTIAL_PATTERN.test(value));
    if (prohibited) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [
          {
            field: prohibited[0],
            code: "DEVICE_CREDENTIAL_NOT_ALLOWED",
            message: "Device unlock credentials must not be stored in intake data.",
          },
        ],
      );
    }
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
