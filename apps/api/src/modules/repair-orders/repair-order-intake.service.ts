/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import type { MediaAsset, Prisma } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { MediaUploadVerifier } from "../media/media-upload-verifier.service.js";
import { type CreateOrderData, RepairOrdersRepository } from "./repair-orders.repository.js";

const DEVICE_CREDENTIAL_PATTERN =
  /(?:pin|password|passcode|unlock(?:\s+code)?|mật khẩu|mat khau)\s*[:#=-]\s*\S+/iu;

export interface IntakeTextInput {
  reportedProblem: string;
  intakeCondition: string;
  accessories: Array<{ name: string; conditionNote: string | null }>;
}

@Injectable()
export class RepairOrderIntakeService {
  constructor(
    private readonly repository: RepairOrdersRepository,
    private readonly mediaVerifier: MediaUploadVerifier,
  ) {}

  rejectDeviceCredentials(input: IntakeTextInput): void {
    const fields = [
      ["reportedProblem", input.reportedProblem],
      ["intakeCondition", input.intakeCondition],
      ...input.accessories.flatMap((item, index) => [
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

  async verifyMedia(
    media: MediaAsset[],
    expectedCount: number,
    requiredMinimum: number,
  ): Promise<void> {
    if (media.length !== expectedCount) {
      throw this.notFound();
    }
    if (media.length < requiredMinimum) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "INTAKE_PHOTOS_REQUIRED",
        "The configured intake photo minimum has not been met.",
      );
    }

    let complete: boolean[];
    try {
      complete = await Promise.all(media.map((asset) => this.mediaVerifier.isComplete(asset)));
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
  }

  async allocateIdentity(
    transaction: Prisma.TransactionClient,
    tenant: Pick<TenantContext, "shopId">,
    shop: { orderCodePrefix: string; timezone: string },
    now: Date,
  ): Promise<{ orderNo: number; code: string }> {
    const orderNo = await this.repository.allocateOrderNumber(transaction, tenant);
    return {
      orderNo,
      code: this.formatOrderCode(shop.orderCodePrefix, shop.timezone, orderNo, now),
    };
  }

  create(
    transaction: Prisma.TransactionClient,
    tenant: Pick<TenantContext, "shopId">,
    data: CreateOrderData,
  ) {
    return this.repository.create(transaction, tenant, data);
  }

  detailInTransaction(
    transaction: Prisma.TransactionClient,
    tenant: Pick<TenantContext, "shopId">,
    repairOrderId: string,
  ) {
    return this.repository.detailInTransaction(transaction, tenant, repairOrderId);
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

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
