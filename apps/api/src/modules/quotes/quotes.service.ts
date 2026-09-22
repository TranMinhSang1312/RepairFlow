/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { QuoteStatus, RepairOrderStatus } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { calculateQuote, type QuoteCalculationItem } from "./quote-calculator.js";
import type { CreateQuoteDto } from "./quote.dto.js";
import { toQuoteView, type QuoteResponse } from "./quote.types.js";
import { QuotesRepository } from "./quotes.repository.js";

const QUOTE_ELIGIBLE_STATES = new Set<RepairOrderStatus>([
  RepairOrderStatus.DIAGNOSING,
  RepairOrderStatus.REPAIRING,
]);
const MAX_SAFE_MONEY = BigInt(Number.MAX_SAFE_INTEGER);
const DEVICE_CREDENTIAL_PATTERN =
  /(?:pin|password|passcode|unlock(?:\s+code)?|mật khẩu|mat khau)\s*[:#=-]\s*\S+/iu;

@Injectable()
export class QuotesService {
  constructor(private readonly repository: QuotesRepository) {}

  async create(
    tenant: TenantContext,
    repairOrderId: string,
    dto: CreateQuoteDto,
  ): Promise<QuoteResponse> {
    if (!this.isUuid(repairOrderId)) throw this.notFound();
    const normalizedOrderId = repairOrderId.toLowerCase();
    const input = this.normalizeAndCalculate(dto);

    return this.repository.withTransaction(async (transaction) => {
      await this.repository.lock(transaction, tenant.shopId, normalizedOrderId);
      const order = await this.repository.findOrder(transaction, tenant.shopId, normalizedOrderId);
      if (!order) throw this.notFound();
      this.assertEligibleState(order.status);
      await this.assertDiagnosis(transaction, tenant.shopId, normalizedOrderId, input.diagnosisId);

      const quote = await this.repository.createDraft(transaction, {
        ...input,
        shopId: tenant.shopId,
        repairOrderId: normalizedOrderId,
        versionNo: await this.repository.allocateVersion(
          transaction,
          tenant.shopId,
          normalizedOrderId,
        ),
        actorUserId: tenant.userId,
        requestId: tenant.requestId,
      });
      return { data: toQuoteView(quote) };
    });
  }

  async replace(
    tenant: TenantContext,
    quoteVersionId: string,
    dto: CreateQuoteDto,
  ): Promise<QuoteResponse> {
    if (!this.isUuid(quoteVersionId)) throw this.notFound();
    const normalizedQuoteId = quoteVersionId.toLowerCase();
    const input = this.normalizeAndCalculate(dto);

    return this.repository.withTransaction(async (transaction) => {
      const reference = await this.repository.findQuoteReference(
        transaction,
        tenant.shopId,
        normalizedQuoteId,
      );
      if (!reference) throw this.notFound();

      await this.repository.lock(transaction, tenant.shopId, reference.repairOrderId);
      const quote = await this.repository.findQuoteForUpdate(
        transaction,
        tenant.shopId,
        normalizedQuoteId,
      );
      if (!quote) throw this.notFound();
      if (quote.status !== QuoteStatus.DRAFT) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "QUOTE_IMMUTABLE",
          "Sent or terminal quote versions cannot be changed.",
        );
      }
      this.assertEligibleState(quote.repairOrder.status);
      await this.assertDiagnosis(
        transaction,
        tenant.shopId,
        quote.repairOrderId,
        input.diagnosisId,
      );

      const updated = await this.repository.replaceDraft(transaction, {
        ...input,
        shopId: tenant.shopId,
        repairOrderId: quote.repairOrderId,
        quoteVersionId: normalizedQuoteId,
        actorUserId: tenant.userId,
        requestId: tenant.requestId,
      });
      return { data: toQuoteView(updated) };
    });
  }

  private normalizeAndCalculate(dto: CreateQuoteDto) {
    if (dto.items.length === 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "QUOTE_ITEMS_REQUIRED",
        "A quote must contain at least one item.",
      );
    }
    this.rejectDeviceCredentials(dto);

    const items: QuoteCalculationItem[] = dto.items.map((item, index) => {
      const approvalGroup = item.approvalGroup?.trim() || null;
      if (!item.isOptional && approvalGroup) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "QUOTE_APPROVAL_GROUP_INVALID",
          "Approval groups may only be assigned to optional items.",
          [
            {
              field: `items.${index}.approvalGroup`,
              code: "REQUIRED_ITEM_GROUP_NOT_ALLOWED",
              message: "Required items cannot have an approval group.",
            },
          ],
        );
      }
      return {
        kind: item.kind,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        isOptional: item.isOptional,
        approvalGroup,
      };
    });
    const calculation = calculateQuote(items, dto.discount ?? 0);
    if (calculation.total < 0n) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [
          {
            field: "discount",
            code: "DISCOUNT_EXCEEDS_SUBTOTAL",
            message: "discount cannot exceed subtotal",
          },
        ],
      );
    }
    if (
      calculation.subtotal > MAX_SAFE_MONEY ||
      calculation.discount > MAX_SAFE_MONEY ||
      calculation.total > MAX_SAFE_MONEY ||
      calculation.items.some((item) => item.lineTotal > MAX_SAFE_MONEY)
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [{ field: "items", code: "MONEY_OUT_OF_RANGE", message: "quote totals are too large" }],
      );
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [{ field: "expiresAt", code: "MUST_BE_FUTURE", message: "expiresAt must be future" }],
      );
    }

    return {
      diagnosisId: dto.diagnosisId?.toLowerCase() ?? null,
      calculation,
      customerNote: dto.customerNote?.trim() || null,
      expiresAt,
    };
  }

  private async assertDiagnosis(
    transaction: Parameters<Parameters<QuotesRepository["withTransaction"]>[0]>[0],
    shopId: string,
    repairOrderId: string,
    diagnosisId: string | null,
  ): Promise<void> {
    if (
      diagnosisId &&
      !(await this.repository.findDiagnosis(transaction, shopId, repairOrderId, diagnosisId))
    ) {
      throw this.notFound();
    }
  }

  private assertEligibleState(status: RepairOrderStatus): void {
    if (!QUOTE_ELIGIBLE_STATES.has(status)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "REPAIR_ORDER_GUARD_FAILED",
        "A quote can only be prepared while diagnosing or repairing an order.",
      );
    }
  }

  private rejectDeviceCredentials(dto: CreateQuoteDto): void {
    const fields: Array<[string, string | null | undefined]> = [
      ["customerNote", dto.customerNote],
      ...dto.items.map(
        (item, index) => [`items.${index}.description`, item.description] as [string, string],
      ),
    ];
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
            message: "Device unlock credentials must not be stored in quote data.",
          },
        ],
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
