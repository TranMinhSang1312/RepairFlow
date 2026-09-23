/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ActorType,
  CompletionOutcome,
  Prisma,
  QuoteDecision,
  QuoteStatus,
  RepairOrderStatus,
  TokenScope,
} from "@prisma/client";
import type { Request } from "express";

import { ApiException } from "../../common/api-exception.js";
import { RateLimiterService } from "../../common/auth/rate-limiter.service.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import { PublicTokenService } from "../public-access/public-token.service.js";
import { RepairOrderStateMachineService } from "../repair-orders/state-machine/repair-order-state-machine.service.js";
import type { QuoteDecisionDto } from "./public-portal.dto.js";
import { PublicPortalRepository, type PublicTokenRecord } from "./public-portal.repository.js";
import type {
  PublicOrderResponse,
  PublicQuoteView,
  QuoteDecisionResponse,
} from "./public-portal.types.js";

const PUBLIC_READ_POLICY = { limit: 60, windowMs: 15 * 60 * 1000 } as const;
const PUBLIC_DECISION_POLICY = { limit: 20, windowMs: 15 * 60 * 1000 } as const;
type QuoteItem = NonNullable<PublicTokenRecord["quoteVersion"]>["items"][number];

interface DecisionCalculation {
  status: QuoteStatus;
  approvedItems: QuoteItem[];
  approvedTotal: bigint;
}

@Injectable()
export class PublicPortalService {
  constructor(
    private readonly repository: PublicPortalRepository,
    private readonly tokens: PublicTokenService,
    private readonly rateLimiter: RateLimiterService,
    private readonly idempotency: IdempotencyService,
    private readonly stateMachine: RepairOrderStateMachineService,
  ) {}

  getOrder(rawToken: string, request: Request): Promise<PublicOrderResponse> {
    this.assertRateLimit("read", rawToken, request, PUBLIC_READ_POLICY);
    this.assertTokenShape(rawToken);
    const tokenHash = this.tokens.hash(rawToken);

    return this.repository.withTransaction(async (transaction) => {
      const record = await this.repository.findToken(transaction, tokenHash);
      this.assertReadable(record);
      await this.repository.touchToken(transaction, record.id, new Date());
      return this.toPublicOrder(record);
    });
  }

  async decide(
    rawToken: string,
    dto: QuoteDecisionDto,
    idempotencyKey: string | undefined,
    request: Request,
  ): Promise<QuoteDecisionResponse> {
    this.assertRateLimit("decision", rawToken, request, PUBLIC_DECISION_POLICY);
    this.assertTokenShape(rawToken);
    const tokenHash = this.tokens.hash(rawToken);
    // This lookup only discovers the trusted tenant for idempotency scoping. The full record is
    // locked and checked again inside the write transaction.
    const preliminary = await this.repository.findTokenCurrent(tokenHash);
    this.assertReadable(preliminary, TokenScope.DECIDE_QUOTE);

    const approvedItemIds = [...(dto.approvedItemIds ?? [])].sort();
    const customerNote = dto.customerNote?.trim() || null;
    const requestId = this.requestId(request);
    const actorFingerprint = this.tokens.requestFingerprint(
      this.clientIp(request),
      request.get("user-agent") ?? "unknown",
    );

    return this.idempotency.execute({
      tenant: { shopId: preliminary.shopId },
      scope: "public.quote-decision",
      key: idempotencyKey,
      request: {
        tokenHash,
        decision: dto.decision,
        approvedItemIds,
        customerNote,
      },
      responseStatus: HttpStatus.OK,
      recordExpiresAt: () => preliminary.expiresAt,
      onReplay: async (transaction) => {
        const current = await this.repository.findToken(transaction, tokenHash);
        this.assertReadable(current, TokenScope.DECIDE_QUOTE);
        await this.repository.touchToken(transaction, current.id, new Date());
      },
      operation: async (transaction) => {
        await this.repository.lock(transaction, preliminary.shopId, preliminary.repairOrderId);
        const record = await this.repository.findToken(transaction, tokenHash);
        this.assertReadable(record, TokenScope.DECIDE_QUOTE);
        const quote = record.quoteVersion!;

        if (quote.status !== QuoteStatus.SENT || quote.approval) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "QUOTE_ALREADY_DECIDED",
            "A final decision already exists for this quote.",
          );
        }
        if (record.repairOrder.status !== RepairOrderStatus.AWAITING_APPROVAL) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "REPAIR_ORDER_GUARD_FAILED",
            "The repair order is not awaiting quote approval.",
          );
        }

        const calculation = this.calculateDecision(
          quote.items,
          quote.discount,
          dto.decision,
          approvedItemIds,
        );
        const decidedAt = new Date();
        if (
          !(await this.repository.updateQuoteDecision(transaction, {
            shopId: record.shopId,
            quoteVersionId: quote.id,
            status: calculation.status,
            decidedAt,
          }))
        ) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "QUOTE_ALREADY_DECIDED",
            "A final decision already exists for this quote.",
          );
        }

        await this.repository.createApproval(transaction, {
          shopId: record.shopId,
          quoteVersionId: quote.id,
          decision: dto.decision,
          approvedItemSnapshot: this.approvedSnapshot(calculation.approvedItems),
          approvedTotal: calculation.approvedTotal,
          customerNote,
          actorFingerprint,
          idempotencyKeyHash: this.tokens.idempotencyKeyHash(idempotencyKey!),
          decidedAt,
        });

        const declined = dto.decision === QuoteDecision.DECLINED;
        await this.stateMachine.transitionInTransaction(transaction, {
          shopId: record.shopId,
          repairOrderId: record.repairOrderId,
          targetStatus: declined ? RepairOrderStatus.READY_FOR_PICKUP : RepairOrderStatus.APPROVED,
          completionOutcome: declined ? CompletionOutcome.DECLINED_QUOTE : null,
          reason: null,
          expectedLockVersion: record.repairOrder.lockVersion,
          actor: { type: ActorType.CUSTOMER_TOKEN, userId: null, role: null },
          requestId,
        });
        await this.repository.appendDecisionArtifacts(transaction, {
          shopId: record.shopId,
          repairOrderId: record.repairOrderId,
          quoteVersionId: quote.id,
          decision: dto.decision,
          approvedTotal: calculation.approvedTotal,
          decidedAt,
          requestId,
        });
        await this.repository.touchToken(transaction, record.id, decidedAt);

        return {
          data: {
            quoteVersionId: quote.id,
            decision: dto.decision,
            approvedTotal: Number(calculation.approvedTotal),
            decidedAt: decidedAt.toISOString(),
          },
        };
      },
    });
  }

  private assertReadable(
    record: PublicTokenRecord | null,
    requiredScope?: TokenScope,
  ): asserts record is PublicTokenRecord {
    if (!record || (requiredScope && record.scope !== requiredScope)) throw this.invalidLink();
    const quote = record.quoteVersion;
    if (quote?.status === QuoteStatus.SUPERSEDED) {
      throw new ApiException(
        HttpStatus.GONE,
        "PUBLIC_QUOTE_UNAVAILABLE",
        "This quote is no longer available.",
      );
    }
    if (record.revokedAt) throw this.invalidLink();
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new ApiException(
        HttpStatus.GONE,
        "PUBLIC_LINK_EXPIRED",
        "This public link has expired.",
      );
    }
    if (quote && (quote.repairOrderId !== record.repairOrderId || quote.shopId !== record.shopId)) {
      throw this.invalidLink();
    }
    if (record.scope === TokenScope.DECIDE_QUOTE && !quote) throw this.invalidLink();
    if (
      quote &&
      (quote.status === QuoteStatus.EXPIRED ||
        !quote.expiresAt ||
        quote.expiresAt.getTime() <= Date.now())
    ) {
      throw new ApiException(
        HttpStatus.GONE,
        "PUBLIC_QUOTE_UNAVAILABLE",
        "This quote is no longer available.",
      );
    }
    if (quote && (quote.status === QuoteStatus.DRAFT || !quote.sentAt)) throw this.invalidLink();
  }

  private calculateDecision(
    items: QuoteItem[],
    discount: bigint,
    decision: QuoteDecision,
    approvedItemIds: string[],
  ): DecisionCalculation {
    const approvedIds = new Set(approvedItemIds);
    const optionalItems = items.filter((item) => item.isOptional);
    const optionalIds = new Set(optionalItems.map(({ id }) => id));
    if (approvedItemIds.some((id) => !optionalIds.has(id))) {
      throw this.invalidApprovalGroup("approvedItemIds may contain only optional quote items.");
    }

    if (decision === QuoteDecision.DECLINED) {
      if (approvedIds.size > 0) {
        throw this.invalidApprovalGroup("A declined quote cannot contain approved item IDs.");
      }
      return { status: QuoteStatus.DECLINED, approvedItems: [], approvedTotal: 0n };
    }

    if (decision === QuoteDecision.ACCEPTED) {
      if (approvedIds.size > 0 && approvedIds.size !== optionalItems.length) {
        throw this.invalidApprovalGroup("An accepted quote must include every optional item.");
      }
      const approvedTotal = this.discountedTotal(items, discount);
      return { status: QuoteStatus.ACCEPTED, approvedItems: items, approvedTotal };
    }

    if (optionalItems.length === 0 || approvedIds.size === optionalItems.length) {
      throw this.invalidApprovalGroup(
        "A partial decision must leave at least one optional item unapproved.",
      );
    }

    const grouped = new Map<string, QuoteItem[]>();
    for (const item of optionalItems) {
      if (!item.approvalGroup) continue;
      grouped.set(item.approvalGroup, [...(grouped.get(item.approvalGroup) ?? []), item]);
    }
    for (const groupItems of grouped.values()) {
      const selectedCount = groupItems.filter((item) => approvedIds.has(item.id)).length;
      if (selectedCount !== 0 && selectedCount !== groupItems.length) {
        throw this.invalidApprovalGroup("Items in one approval group must be selected together.");
      }
    }

    const approvedItems = items.filter((item) => !item.isOptional || approvedIds.has(item.id));
    return {
      status: QuoteStatus.PARTIALLY_ACCEPTED,
      approvedItems,
      approvedTotal: this.discountedTotal(approvedItems, discount),
    };
  }

  private discountedTotal(items: QuoteItem[], discount: bigint): bigint {
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0n);
    return subtotal > discount ? subtotal - discount : 0n;
  }

  private approvedSnapshot(items: QuoteItem[]): Prisma.InputJsonValue {
    return items.map((item) => ({
      id: item.id,
      kind: item.kind,
      description: item.description,
      quantity: Number(item.quantity.toString()),
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
      isOptional: item.isOptional,
      approvalGroup: item.approvalGroup,
    }));
  }

  private toPublicOrder(record: PublicTokenRecord): PublicOrderResponse {
    return {
      data: {
        shopName: record.repairOrder.shop.name,
        shopContact: record.repairOrder.shop.contactPhone,
        orderCode: record.repairOrder.code,
        deviceLabel: this.deviceLabel(record.repairOrder.deviceSnapshot),
        status: record.repairOrder.status,
        completionOutcome: record.repairOrder.completionOutcome,
        timeline: record.repairOrder.events.map((event) => ({
          type: event.eventType,
          message: this.publicEventMessage(event.eventType, event.publicPayload),
          createdAt: event.createdAt.toISOString(),
        })),
        quote:
          record.scope === TokenScope.DECIDE_QUOTE && record.quoteVersion
            ? this.toPublicQuote(record.quoteVersion)
            : null,
      },
    };
  }

  private toPublicQuote(quote: NonNullable<PublicTokenRecord["quoteVersion"]>): PublicQuoteView {
    return {
      id: quote.id,
      versionNo: quote.versionNo,
      status: quote.status,
      currency: quote.currency,
      items: quote.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        description: item.description,
        quantity: Number(item.quantity.toString()),
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
        isOptional: item.isOptional,
        approvalGroup: item.approvalGroup,
      })),
      subtotal: Number(quote.subtotal),
      discount: Number(quote.discount),
      total: Number(quote.total),
      customerNote: quote.customerNote,
      expiresAt: quote.expiresAt!.toISOString(),
      sentAt: quote.sentAt!.toISOString(),
      decidedAt: quote.decidedAt?.toISOString() ?? null,
    };
  }

  private publicEventMessage(eventType: string, payload: Prisma.JsonValue): string {
    const object = this.jsonObject(payload);
    if (typeof object.message === "string" && object.message.trim()) return object.message;
    if (typeof object.status === "string") return `Repair status changed to ${object.status}.`;
    if (eventType === "REPAIR_ORDER_RECEIVED") return "The device was received.";
    if (eventType === "QUOTE_SENT") return "A quote was sent for approval.";
    return "The repair order was updated.";
  }

  private deviceLabel(snapshot: Prisma.JsonValue): string {
    const object = this.jsonObject(snapshot);
    const parts = [object.brand, object.model].filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0,
    );
    if (parts.length > 0) return parts.join(" ");
    return typeof object.type === "string" && object.type.trim() ? object.type : "Device";
  }

  private jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, Prisma.JsonValue>)
      : {};
  }

  private assertRateLimit(
    operation: string,
    rawToken: string,
    request: Request,
    policy: { limit: number; windowMs: number },
  ): void {
    const key = this.tokens.rateLimitKey(rawToken, this.clientIp(request));
    this.rateLimiter.assertAllowed(`public-${operation}:${key}`, policy);
  }

  private assertTokenShape(rawToken: string): void {
    if (rawToken.length < 32 || rawToken.length > 256) throw this.invalidLink();
  }

  private clientIp(request: Request): string {
    return request.ip || request.socket.remoteAddress || "unknown";
  }

  private requestId(request: Request): string {
    return "id" in request && typeof request.id === "string" ? request.id : "unknown";
  }

  private invalidLink(): ApiException {
    return new ApiException(
      HttpStatus.NOT_FOUND,
      "PUBLIC_LINK_INVALID",
      "This public link is invalid.",
    );
  }

  private invalidApprovalGroup(message: string): ApiException {
    return new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "QUOTE_APPROVAL_GROUP_INVALID",
      message,
      [{ field: "approvedItemIds", code: "INVALID_SELECTION", message }],
    );
  }
}
