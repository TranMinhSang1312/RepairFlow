/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { PaymentDisposition, RepairOrderStatus } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import type { CreatePaymentDto } from "./payment.dto.js";
import {
  calculatePaymentSummary,
  toPaymentSummaryView,
  toPaymentView,
  type PaymentResponse,
} from "./payment.types.js";
import { PaymentsRepository } from "./payments.repository.js";

@Injectable()
export class PaymentsService {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  create(
    tenant: TenantContext,
    repairOrderId: string,
    dto: CreatePaymentDto,
    idempotencyKey: string | undefined,
  ): Promise<PaymentResponse> {
    if (!this.isUuid(repairOrderId)) throw this.notFound();
    const orderId = repairOrderId.toLowerCase();
    const reference = dto.reference?.trim() || null;

    return this.idempotency.execute({
      tenant,
      scope: "payments.create",
      key: idempotencyKey,
      request: { repairOrderId: orderId, amount: dto.amount, method: dto.method, reference },
      operation: async (transaction) => {
        await this.repository.lockOrder(transaction, tenant.shopId, orderId);
        const order = await this.repository.findOrder(transaction, tenant.shopId, orderId);
        if (!order) throw this.notFound();

        const permittedBeforeHandover = order.status === RepairOrderStatus.READY_FOR_PICKUP;
        const permittedAfterHandover =
          order.status === RepairOrderStatus.COMPLETED &&
          (order.handover?.paymentDisposition === PaymentDisposition.PARTIALLY_PAID ||
            order.handover?.paymentDisposition === PaymentDisposition.PAY_LATER);
        if (!permittedBeforeHandover && !permittedAfterHandover) throw this.paymentNotAllowed();
        const binding = order.quoteVersions[0]?.approval;
        if (!binding) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "APPROVED_SCOPE_REQUIRED",
            "A binding approved quote is required before recording payment.",
          );
        }
        const summary = calculatePaymentSummary(binding.approvedTotal, order.payments);
        if (summary.amountDue <= 0n) throw this.paymentNotAllowed();

        const amount = BigInt(dto.amount);
        if (amount > summary.amountDue) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "PAYMENT_EXCEEDS_BALANCE",
            "Payment exceeds the authoritative amount due.",
          );
        }
        const receivedAt = new Date();
        const payment = await this.repository.createPayment(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          amount,
          method: dto.method,
          reference,
          actorUserId: tenant.userId,
          receivedAt,
        });
        await this.repository.appendPaymentArtifacts(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          actorUserId: tenant.userId,
          requestId: tenant.requestId,
          receivedAt,
        });
        return {
          data: {
            payment: toPaymentView(payment),
            summary: toPaymentSummaryView({
              ...summary,
              paidTotal: summary.paidTotal + amount,
              amountDue: summary.amountDue - amount,
            }),
          },
        };
      },
    });
  }

  private paymentNotAllowed(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      "PAYMENT_NOT_ALLOWED",
      "Payment is not allowed for this repair order.",
    );
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
