/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ActorType,
  CompletionOutcome,
  MediaPurpose,
  PaymentDisposition,
  RepairOrderStatus,
  TokenScope,
} from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { MediaUploadVerifier } from "../media/media-upload-verifier.service.js";
import {
  calculatePaymentSummary,
  toPaymentSummaryView,
  toPaymentView,
  type MonetarySummary,
} from "../payments/payment.types.js";
import {
  PublicTokenService,
  type TrackTokenMetadata,
} from "../public-access/public-token.service.js";
import { toRepairOrderView } from "../repair-orders/repair-order.types.js";
import { RepairOrderStateMachineService } from "../repair-orders/state-machine/repair-order-state-machine.service.js";
import type { CompleteHandoverDto } from "./handover.dto.js";
import {
  toHandoverView,
  toWarrantyView,
  type HandoverReplayDescriptor,
  type HandoverResponse,
} from "./handover.types.js";
import { HandoversRepository } from "./handovers.repository.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class HandoversService {
  constructor(
    private readonly repository: HandoversRepository,
    private readonly idempotency: IdempotencyService,
    private readonly mediaVerifier: MediaUploadVerifier,
    private readonly tokens: PublicTokenService,
    private readonly stateMachine: RepairOrderStateMachineService,
  ) {}

  async complete(
    tenant: TenantContext,
    repairOrderId: string,
    dto: CompleteHandoverDto,
    idempotencyKey: string | undefined,
  ): Promise<HandoverResponse> {
    if (!this.isUuid(repairOrderId)) throw this.notFound();
    const orderId = repairOrderId.toLowerCase();
    const request = {
      repairOrderId: orderId,
      recipientName: dto.recipientName.trim(),
      paymentDisposition: dto.paymentDisposition,
      paymentNote: dto.paymentNote?.trim() || null,
      signatureMediaAssetId: dto.signatureMediaAssetId?.toLowerCase() ?? null,
      expectedLockVersion: dto.expectedLockVersion,
      payment: dto.payment
        ? {
            amount: dto.payment.amount,
            method: dto.payment.method,
            reference: dto.payment.reference?.trim() || null,
          }
        : null,
      warranty: dto.warranty
        ? { endsAt: dto.warranty.endsAt, terms: dto.warranty.terms.trim() }
        : null,
    };

    const descriptor = await this.idempotency.executeStored<HandoverReplayDescriptor>({
      tenant,
      scope: "handovers.complete",
      key: idempotencyKey,
      request,
      recordExpiresAt: (stored) => new Date(stored.tracking.expiresAt),
      onReplay: (transaction, stored) =>
        this.assertReplayTrack(transaction, tenant.shopId, orderId, stored.tracking),
      onExpiredReplay: async () => {
        throw this.tokenExpired();
      },
      operation: async (transaction) => {
        await this.repository.lockOrder(transaction, tenant.shopId, orderId);
        const order = await this.repository.findOrder(transaction, tenant.shopId, orderId);
        if (!order) throw this.notFound();
        if (order.handover || order.status === RepairOrderStatus.COMPLETED) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "HANDOVER_ALREADY_COMPLETED",
            "The repair order has already been handed over.",
          );
        }
        if (order.status !== RepairOrderStatus.READY_FOR_PICKUP) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "REPAIR_ORDER_INVALID_TRANSITION",
            `Transition from ${order.status} to COMPLETED is not allowed.`,
          );
        }
        if (order.lockVersion !== request.expectedLockVersion) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "CONCURRENT_UPDATE",
            "The repair order was changed by another request.",
          );
        }
        const outcome = order.completionOutcome;
        if (!outcome) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "COMPLETION_OUTCOME_REQUIRED",
            "A valid completion outcome is required before handover.",
          );
        }

        const binding = order.quoteVersions[0]?.approval ?? null;
        const repaired = outcome === CompletionOutcome.REPAIRED;
        if (repaired && !binding) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "APPROVED_SCOPE_REQUIRED",
            "A repaired handover requires a binding approved quote.",
          );
        }
        if (!binding && (order.payments.length > 0 || request.payment)) {
          throw this.paymentNotAllowed();
        }

        const currentSummary = calculatePaymentSummary(
          binding?.approvedTotal ?? 0n,
          order.payments,
        );
        const paymentAmount = request.payment ? BigInt(request.payment.amount) : 0n;
        if (request.payment && currentSummary.amountDue <= 0n) throw this.paymentNotAllowed();
        if (paymentAmount > currentSummary.amountDue) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "PAYMENT_EXCEEDS_BALANCE",
            "Payment exceeds the authoritative amount due.",
          );
        }
        const finalSummary: MonetarySummary = {
          approvedTotal: currentSummary.approvedTotal,
          paidTotal: currentSummary.paidTotal + paymentAmount,
          amountDue: currentSummary.amountDue - paymentAmount,
        };
        this.assertDisposition(request.paymentDisposition, request.paymentNote, finalSummary);

        const handedOverAt = new Date();
        const warrantyInput = this.validateWarranty(repaired, request.warranty, handedOverAt);
        if (request.signatureMediaAssetId) {
          await this.verifyAndFinalizeMedia(
            transaction,
            tenant.shopId,
            orderId,
            request.signatureMediaAssetId,
            handedOverAt,
          );
        }

        const payment = request.payment
          ? await this.repository.createPayment(transaction, {
              shopId: tenant.shopId,
              repairOrderId: orderId,
              amount: paymentAmount,
              method: request.payment.method,
              reference: request.payment.reference,
              actorUserId: tenant.userId,
              receivedAt: handedOverAt,
            })
          : null;
        const handover = await this.repository.createHandover(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          recipientName: request.recipientName,
          paymentDisposition: request.paymentDisposition,
          paymentNote: request.paymentNote,
          signatureMediaAssetId: request.signatureMediaAssetId,
          actorUserId: tenant.userId,
          handedOverAt,
        });
        const warranty = warrantyInput
          ? await this.repository.createWarranty(transaction, {
              shopId: tenant.shopId,
              repairOrderId: orderId,
              startsAt: handedOverAt,
              endsAt: warrantyInput.endsAt,
              terms: warrantyInput.terms,
            })
          : null;

        await this.repository.revokePublicTokens(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          revokedAt: handedOverAt,
        });
        const trackExpiresAt = this.trackExpiry(handedOverAt, warranty?.endsAt ?? null);
        const tracking = this.tokens.newTrackMetadata({
          shopId: tenant.shopId,
          repairOrderId: orderId,
          expiresAt: trackExpiresAt.toISOString(),
        });
        const rawToken = this.tokens.deriveTrackRawToken(tracking);
        await this.repository.createTrackToken(transaction, tracking, this.tokens.hash(rawToken));

        await this.stateMachine.transitionAfterHandover(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          targetStatus: RepairOrderStatus.COMPLETED,
          completionOutcome: null,
          reason: null,
          expectedLockVersion: request.expectedLockVersion,
          evidenceId: handover.id,
          actor: { type: ActorType.USER, userId: tenant.userId, role: tenant.role },
          requestId: tenant.requestId,
        });
        await this.repository.appendCompletionArtifacts(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          completionOutcome: outcome,
          actorUserId: tenant.userId,
          requestId: tenant.requestId,
          handedOverAt,
          warrantyEndsAt: warranty?.endsAt ?? null,
          paymentRecorded: payment !== null,
        });

        return {
          repairOrderId: orderId,
          handoverId: handover.id,
          paymentId: payment?.id ?? null,
          warrantyId: warranty?.id ?? null,
          tracking,
        };
      },
    });

    return this.responseFromDescriptor(tenant.shopId, descriptor);
  }

  private async responseFromDescriptor(
    shopId: string,
    descriptor: HandoverReplayDescriptor,
  ): Promise<HandoverResponse> {
    if (descriptor.tracking.expiresAt <= new Date().toISOString()) throw this.tokenExpired();
    const order = await this.repository.loadCompletedAggregate(shopId, descriptor.repairOrderId);
    if (
      !order?.handover ||
      order.handover.id !== descriptor.handoverId ||
      order.status !== RepairOrderStatus.COMPLETED
    ) {
      throw this.notFound();
    }
    const warranty = descriptor.warrantyId
      ? order.warranty?.id === descriptor.warrantyId
        ? order.warranty
        : null
      : null;
    if (descriptor.warrantyId && !warranty) throw this.notFound();
    const payment = descriptor.paymentId
      ? (order.payments.find((candidate) => candidate.id === descriptor.paymentId) ?? null)
      : null;
    if (descriptor.paymentId && !payment) throw this.notFound();

    const paymentsAtHandover = order.payments.filter(
      (candidate) => candidate.receivedAt <= order.handover!.handedOverAt,
    );
    const summary = calculatePaymentSummary(
      order.quoteVersions[0]?.approval?.approvedTotal ?? 0n,
      paymentsAtHandover,
    );
    return {
      data: {
        order: toRepairOrderView(order),
        handover: toHandoverView(order.handover),
        payment: payment ? toPaymentView(payment) : null,
        warranty: warranty ? toWarrantyView(warranty) : null,
        paymentSummary: toPaymentSummaryView(summary),
        trackingUrl: this.tokens.trackPublicUrl(descriptor.tracking),
        trackingExpiresAt: descriptor.tracking.expiresAt,
      },
    };
  }

  private async assertReplayTrack(
    transaction: Parameters<HandoversRepository["findTrackToken"]>[0],
    shopId: string,
    repairOrderId: string,
    metadata: TrackTokenMetadata,
  ): Promise<void> {
    if (
      metadata.shopId !== shopId ||
      metadata.repairOrderId !== repairOrderId ||
      metadata.expiresAt <= new Date().toISOString()
    ) {
      throw this.tokenExpired();
    }
    const token = await this.repository.findTrackToken(transaction, metadata.tokenId);
    const expectedHash = this.tokens.hash(this.tokens.deriveTrackRawToken(metadata));
    if (
      !token ||
      token.shopId !== shopId ||
      token.repairOrderId !== repairOrderId ||
      token.scope !== TokenScope.TRACK_ORDER ||
      token.tokenHash !== expectedHash ||
      token.expiresAt.toISOString() !== metadata.expiresAt ||
      token.expiresAt <= new Date() ||
      token.revokedAt
    ) {
      throw this.tokenExpired();
    }
  }

  private async verifyAndFinalizeMedia(
    transaction: Parameters<HandoversRepository["findMedia"]>[0],
    shopId: string,
    repairOrderId: string,
    mediaAssetId: string,
    now: Date,
  ): Promise<void> {
    const asset = await this.repository.findMedia(transaction, shopId, mediaAssetId);
    if (
      !asset ||
      asset.repairOrderId !== repairOrderId ||
      (asset.purpose !== MediaPurpose.SIGNATURE && asset.purpose !== MediaPurpose.HANDOVER)
    ) {
      throw this.notFound();
    }
    let complete: boolean;
    try {
      complete = await this.mediaVerifier.isCompleteForOrder(asset, repairOrderId, now);
    } catch {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "STORAGE_UNAVAILABLE",
        "Private object storage is temporarily unavailable.",
      );
    }
    if (!complete) throw this.mediaIncomplete();
    const finalized = await this.repository.finalizeMedia(transaction, {
      shopId,
      repairOrderId,
      mediaAssetId,
      now,
    });
    if (finalized.count !== 1) throw this.mediaIncomplete();
  }

  private validateWarranty(
    repaired: boolean,
    warranty: { endsAt: string; terms: string } | null,
    handedOverAt: Date,
  ): { endsAt: Date; terms: string } | null {
    if (!repaired) {
      if (warranty) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "VALIDATION_FAILED",
          "One or more input fields are invalid.",
          [{ field: "warranty", code: "NOT_ALLOWED", message: "Warranty is repaired-only." }],
        );
      }
      return null;
    }
    const endsAt = warranty ? new Date(warranty.endsAt) : null;
    if (!warranty || !warranty.terms.trim() || !endsAt || endsAt <= handedOverAt) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "WARRANTY_REQUIRED",
        "A repaired handover requires valid warranty terms and a future end time.",
      );
    }
    return { endsAt, terms: warranty.terms.trim() };
  }

  private assertDisposition(
    disposition: PaymentDisposition,
    note: string | null,
    summary: MonetarySummary,
  ): void {
    const hasNote = Boolean(note?.trim());
    const valid =
      (disposition === PaymentDisposition.PAID && summary.amountDue === 0n) ||
      (disposition === PaymentDisposition.PARTIALLY_PAID &&
        summary.amountDue > 0n &&
        summary.paidTotal > 0n &&
        hasNote) ||
      (disposition === PaymentDisposition.PAY_LATER && summary.amountDue > 0n && hasNote) ||
      (disposition === PaymentDisposition.WAIVED && summary.amountDue > 0n && hasNote);
    if (!valid) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "PAYMENT_DISPOSITION_INVALID",
        "Payment disposition does not match the authoritative balance.",
      );
    }
  }

  private trackExpiry(handedOverAt: Date, warrantyEndsAt: Date | null): Date {
    const oneYear = handedOverAt.getTime() + 365 * ONE_DAY_MS;
    const warrantyRetention = warrantyEndsAt ? warrantyEndsAt.getTime() + 30 * ONE_DAY_MS : 0;
    return new Date(Math.max(oneYear, warrantyRetention));
  }

  private paymentNotAllowed(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      "PAYMENT_NOT_ALLOWED",
      "Payment is not allowed for this repair order.",
    );
  }

  private mediaIncomplete(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      "MEDIA_UPLOAD_INCOMPLETE",
      "The handover upload is incomplete or expired.",
    );
  }

  private tokenExpired(): ApiException {
    return new ApiException(
      HttpStatus.GONE,
      "TOKEN_EXPIRED",
      "The tracking token for this idempotent handover has expired.",
    );
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
