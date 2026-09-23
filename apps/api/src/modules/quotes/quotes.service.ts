/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ActorType,
  Prisma,
  QuoteStatus,
  RepairOrderStatus,
  type QuoteItemKind,
  type QuoteQuantityUnit,
} from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { FakeNotificationAdapter } from "../notifications/fake-notification.adapter.js";
import {
  PublicTokenService,
  type QuoteTokenMetadata,
} from "../public-access/public-token.service.js";
import { RepairOrderStateMachineService } from "../repair-orders/state-machine/repair-order-state-machine.service.js";
import { calculateQuote, type QuoteCalculationItem } from "./quote-calculator.js";
import type { CreateQuoteDto, SendQuoteDto } from "./quote.dto.js";
import {
  toQuoteView,
  type QuoteResponse,
  type QuoteView,
  type SendQuoteResponse,
} from "./quote.types.js";
import { QuotesRepository } from "./quotes.repository.js";

const QUOTE_ELIGIBLE_STATES = new Set<RepairOrderStatus>([
  RepairOrderStatus.DIAGNOSING,
  RepairOrderStatus.REPAIRING,
]);
const SEND_ELIGIBLE_STATES = new Set<RepairOrderStatus>([
  RepairOrderStatus.DIAGNOSING,
  RepairOrderStatus.REPAIRING,
  RepairOrderStatus.AWAITING_APPROVAL,
]);
const MAX_SAFE_MONEY = BigInt(Number.MAX_SAFE_INTEGER);
const DEVICE_CREDENTIAL_PATTERN =
  /(?:pin|password|passcode|unlock(?:\s+code)?|mật khẩu|mat khau)\s*[:#=-]\s*\S+/iu;

interface ApprovedSnapshotItem {
  id: string;
  scopeKey: string;
  kind: QuoteItemKind;
  description: string;
  quantity: number;
  quantityUnit: QuoteQuantityUnit;
  unitPrice: number;
  isOptional: boolean;
  approvalGroup: string | null;
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly repository: QuotesRepository,
    private readonly idempotency: IdempotencyService,
    private readonly stateMachine: RepairOrderStateMachineService,
    private readonly publicTokens: PublicTokenService,
    private readonly notifications: FakeNotificationAdapter,
  ) {}

  async create(
    tenant: TenantContext,
    repairOrderId: string,
    dto: CreateQuoteDto,
  ): Promise<QuoteResponse> {
    if (!this.isUuid(repairOrderId)) throw this.notFound();
    const normalizedOrderId = repairOrderId.toLowerCase();
    const input = this.normalizeAndCalculate(dto);

    try {
      return await this.repository.withTransaction(async (transaction) => {
        await this.repository.lock(transaction, tenant.shopId, normalizedOrderId);
        const order = await this.repository.findOrder(
          transaction,
          tenant.shopId,
          normalizedOrderId,
        );
        if (!order) throw this.notFound();
        this.assertEligibleState(order.status);
        await this.assertDiagnosis(
          transaction,
          tenant.shopId,
          normalizedOrderId,
          input.diagnosisId,
        );
        const lineageCount = await this.applyLineage(
          transaction,
          tenant.shopId,
          normalizedOrderId,
          order.status,
          input.calculation.items,
        );

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
        if (lineageCount > 0) {
          await this.repository.appendLineageAuditInTransaction(transaction, {
            shopId: tenant.shopId,
            actorUserId: tenant.userId,
            entityId: normalizedOrderId,
            requestId: tenant.requestId,
            reason: "validated_draft_lineage",
          });
        }
        return { data: toQuoteView(quote) };
      });
    } catch (error) {
      await this.auditRejectedLineage(error, tenant, normalizedOrderId);
      throw error;
    }
  }

  async replace(
    tenant: TenantContext,
    quoteVersionId: string,
    dto: CreateQuoteDto,
  ): Promise<QuoteResponse> {
    if (!this.isUuid(quoteVersionId)) throw this.notFound();
    const normalizedQuoteId = quoteVersionId.toLowerCase();
    const input = this.normalizeAndCalculate(dto);
    let lineageAuditEntityId = normalizedQuoteId;

    try {
      return await this.repository.withTransaction(async (transaction) => {
        const reference = await this.repository.findQuoteReference(
          transaction,
          tenant.shopId,
          normalizedQuoteId,
        );
        if (!reference) throw this.notFound();
        lineageAuditEntityId = reference.repairOrderId;

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
        const lineageCount = await this.applyLineage(
          transaction,
          tenant.shopId,
          quote.repairOrderId,
          quote.repairOrder.status,
          input.calculation.items,
        );

        const updated = await this.repository.replaceDraft(transaction, {
          ...input,
          shopId: tenant.shopId,
          repairOrderId: quote.repairOrderId,
          quoteVersionId: normalizedQuoteId,
          actorUserId: tenant.userId,
          requestId: tenant.requestId,
        });
        if (lineageCount > 0) {
          await this.repository.appendLineageAuditInTransaction(transaction, {
            shopId: tenant.shopId,
            actorUserId: tenant.userId,
            entityId: quote.repairOrderId,
            requestId: tenant.requestId,
            reason: "validated_draft_lineage",
          });
        }
        return { data: toQuoteView(updated) };
      });
    } catch (error) {
      await this.auditRejectedLineage(error, tenant, lineageAuditEntityId);
      throw error;
    }
  }

  async send(
    tenant: TenantContext,
    quoteVersionId: string,
    dto: SendQuoteDto,
    idempotencyKey: string | undefined,
  ): Promise<SendQuoteResponse> {
    if (!this.isUuid(quoteVersionId)) throw this.notFound();
    const normalizedQuoteId = quoteVersionId.toLowerCase();

    try {
      const replay = await this.idempotency.executeStored<{
        quote: QuoteView;
        token: QuoteTokenMetadata;
      }>({
        tenant,
        scope: "quotes.send",
        key: idempotencyKey,
        request: { quoteVersionId: normalizedQuoteId, channel: dto.channel },
        responseStatus: HttpStatus.OK,
        recordExpiresAt: (stored) => new Date(stored.token.expiresAt),
        operation: async (transaction) => {
          const reference = await this.repository.findQuoteReference(
            transaction,
            tenant.shopId,
            normalizedQuoteId,
          );
          if (!reference) throw this.notFound();

          await this.repository.lock(transaction, tenant.shopId, reference.repairOrderId);
          const quote = await this.repository.findQuoteForSend(
            transaction,
            tenant.shopId,
            normalizedQuoteId,
          );
          if (!quote) throw this.notFound();
          if (quote.status !== QuoteStatus.DRAFT) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "QUOTE_NOT_DRAFT",
              "Only a draft quote can be sent.",
            );
          }
          if (!SEND_ELIGIBLE_STATES.has(quote.repairOrder.status)) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "REPAIR_ORDER_GUARD_FAILED",
              "A quote can only be sent while diagnosing, repairing, or awaiting approval.",
            );
          }
          this.assertAuthoritativeTotals(quote);

          if (quote.repairOrder.status === RepairOrderStatus.REPAIRING) {
            const lineageCount = await this.assertReplacementSend(
              transaction,
              tenant.shopId,
              quote.repairOrderId,
              quote,
            );
            if (lineageCount > 0) {
              await this.repository.appendLineageAuditInTransaction(transaction, {
                shopId: tenant.shopId,
                actorUserId: tenant.userId,
                entityId: quote.repairOrderId,
                requestId: tenant.requestId,
                reason: "validated_replacement_send_lineage",
              });
            }
          }

          const activeQuotes = await this.repository.findActiveSentQuotes(
            transaction,
            tenant.shopId,
            quote.repairOrderId,
            quote.id,
          );
          if (
            quote.repairOrder.status === RepairOrderStatus.AWAITING_APPROVAL &&
            activeQuotes.length === 0
          ) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "REPAIR_ORDER_GUARD_FAILED",
              "An active sent quote is required before replacing an awaiting quote.",
            );
          }

          const notification = this.notifications.plan(
            dto.channel,
            this.jsonObject(quote.repairOrder.customerSnapshot),
          );
          const sentAt = new Date();
          const expiresAt =
            quote.expiresAt ??
            new Date(
              sentAt.getTime() + quote.repairOrder.shop.defaultQuoteExpiryHours * 60 * 60 * 1000,
            );
          if (expiresAt.getTime() <= sentAt.getTime()) {
            throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "VALIDATION_FAILED",
              "One or more input fields are invalid.",
              [{ field: "expiresAt", code: "MUST_BE_FUTURE", message: "expiresAt must be future" }],
            );
          }

          await this.repository.supersedeQuotes(
            transaction,
            tenant.shopId,
            activeQuotes.map(({ id }) => id),
            sentAt,
          );
          const sentQuote = await this.repository.markSent(transaction, {
            shopId: tenant.shopId,
            quoteVersionId: quote.id,
            sentAt,
            expiresAt,
          });

          const token = this.publicTokens.newMetadata({
            shopId: tenant.shopId,
            repairOrderId: quote.repairOrderId,
            quoteVersionId: quote.id,
            expiresAt: expiresAt.toISOString(),
          });
          const tokenHash = this.publicTokens.hash(this.publicTokens.deriveRawToken(token));
          await this.repository.createPublicToken(transaction, token, tokenHash);

          if (quote.repairOrder.status !== RepairOrderStatus.AWAITING_APPROVAL) {
            await this.stateMachine.transitionAfterQuoteSend(transaction, {
              shopId: tenant.shopId,
              repairOrderId: quote.repairOrderId,
              targetStatus: RepairOrderStatus.AWAITING_APPROVAL,
              completionOutcome: null,
              reason: "Quote sent for customer approval.",
              expectedLockVersion: quote.repairOrder.lockVersion,
              actor: { type: ActorType.USER, userId: tenant.userId, role: tenant.role },
              requestId: tenant.requestId,
            });
          }

          await this.repository.appendSendArtifacts(transaction, {
            shopId: tenant.shopId,
            repairOrderId: quote.repairOrderId,
            quoteVersionId: quote.id,
            versionNo: quote.versionNo,
            tokenId: token.tokenId,
            tokenExpiresAt: token.expiresAt,
            channel: dto.channel,
            notification,
            actorUserId: tenant.userId,
            requestId: tenant.requestId,
          });

          return { quote: toQuoteView(sentQuote), token };
        },
      });

      return {
        data: {
          quote: replay.quote,
          publicUrl: this.publicTokens.publicUrl(replay.token),
        },
      };
    } catch (error) {
      await this.auditRejectedLineage(error, tenant, normalizedQuoteId);
      throw error;
    }
  }

  private assertAuthoritativeTotals(
    quote: Awaited<ReturnType<QuotesRepository["findQuoteForSend"]>>,
  ): void {
    if (!quote || quote.items.length === 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "QUOTE_ITEMS_REQUIRED",
        "A quote must contain at least one item.",
      );
    }
    const calculation = calculateQuote(
      quote.items.map((item) => ({
        kind: item.kind,
        description: item.description,
        displayNote: item.displayNote,
        carriedFromQuoteItemId: item.carriedFromQuoteItemId,
        scopeKey: item.scopeKey,
        quantity: Number(item.quantity.toString()),
        quantityUnit: item.quantityUnit,
        unitPrice: Number(item.unitPrice),
        isOptional: item.isOptional,
        approvalGroup: item.approvalGroup,
      })),
      Number(quote.discount),
    );
    const totalsMatch =
      calculation.subtotal === quote.subtotal &&
      calculation.discount === quote.discount &&
      calculation.total === quote.total &&
      calculation.items.every((item, index) => item.lineTotal === quote.items[index]?.lineTotal);
    if (!totalsMatch) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [
          {
            field: "items",
            code: "AUTHORITATIVE_TOTAL_MISMATCH",
            message: "Stored quote totals do not match server-calculated totals.",
          },
        ],
      );
    }
  }

  private jsonObject(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
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
        displayNote: item.displayNote?.trim() || null,
        carriedFromQuoteItemId: item.carriedFromQuoteItemId?.toLowerCase() ?? null,
        scopeKey: null,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit,
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

  private async applyLineage(
    transaction: Parameters<Parameters<QuotesRepository["withTransaction"]>[0]>[0],
    shopId: string,
    repairOrderId: string,
    orderStatus: RepairOrderStatus,
    items: QuoteCalculationItem[],
  ): Promise<number> {
    const carriedItems = items.filter((item) => item.carriedFromQuoteItemId);
    if (carriedItems.length === 0) return 0;
    if (orderStatus !== RepairOrderStatus.REPAIRING) {
      throw this.lineageInvalid("Scope can be carried only by a replacement quote during repair.");
    }
    const referenceIds = carriedItems.map((item) => item.carriedFromQuoteItemId!);
    if (new Set(referenceIds).size !== referenceIds.length) {
      throw this.lineageInvalid("A prior quote item cannot be carried more than once.");
    }

    const binding = await this.repository.findBindingApproval(transaction, shopId, repairOrderId);
    if (!binding?.approval) {
      throw this.lineageInvalid("A binding approval is required for replacement lineage.");
    }
    const approved = this.parseApprovedSnapshot(binding.approval.approvedItemSnapshot);
    const approvedById = new Map(approved.map((item) => [item.id, item]));
    const priorById = new Map(binding.items.map((item) => [item.id, item]));

    for (const item of carriedItems) {
      const referenceId = item.carriedFromQuoteItemId!;
      const prior = priorById.get(referenceId);
      const snapshot = approvedById.get(referenceId);
      if (!prior || !snapshot || snapshot.scopeKey !== prior.scopeKey) {
        throw this.lineageInvalid("The carried item is not in the current binding approval.");
      }
      if (
        prior.kind !== item.kind ||
        this.normalizeIdentity(prior.description) !== this.normalizeIdentity(item.description) ||
        !prior.quantity.equals(new Prisma.Decimal(item.quantity.toString())) ||
        prior.quantityUnit !== item.quantityUnit ||
        prior.isOptional !== item.isOptional ||
        this.normalizeGroup(prior.approvalGroup) !== this.normalizeGroup(item.approvalGroup)
      ) {
        throw this.lineageInvalid("The carried item changed binding scope semantics.");
      }
      item.scopeKey = prior.scopeKey;
    }
    return carriedItems.length;
  }

  private async assertReplacementSend(
    transaction: Parameters<Parameters<QuotesRepository["withTransaction"]>[0]>[0],
    shopId: string,
    repairOrderId: string,
    quote: NonNullable<Awaited<ReturnType<QuotesRepository["findQuoteForSend"]>>>,
  ): Promise<number> {
    const binding = await this.repository.findBindingApproval(transaction, shopId, repairOrderId);
    if (!binding?.approval) {
      throw this.guardFailed("A binding approval is required before a replacement quote is sent.");
    }
    const approved = this.parseApprovedSnapshot(binding.approval.approvedItemSnapshot);
    const approvedById = new Map(approved.map((item) => [item.id, item]));
    const priorById = new Map(binding.items.map((item) => [item.id, item]));
    const carriedIds = quote.items.flatMap((item) =>
      item.carriedFromQuoteItemId ? [item.carriedFromQuoteItemId] : [],
    );
    if (new Set(carriedIds).size !== carriedIds.length) {
      throw this.lineageInvalid("A prior quote item cannot be carried more than once.");
    }

    for (const item of quote.items) {
      if (!item.carriedFromQuoteItemId) continue;
      const prior = priorById.get(item.carriedFromQuoteItemId);
      const snapshot = approvedById.get(item.carriedFromQuoteItemId);
      if (
        !prior ||
        !snapshot ||
        item.scopeKey !== prior.scopeKey ||
        snapshot.scopeKey !== prior.scopeKey ||
        prior.kind !== item.kind ||
        this.normalizeIdentity(prior.description) !== this.normalizeIdentity(item.description) ||
        !prior.quantity.equals(item.quantity) ||
        prior.quantityUnit !== item.quantityUnit ||
        prior.isOptional !== item.isOptional ||
        this.normalizeGroup(prior.approvalGroup) !== this.normalizeGroup(item.approvalGroup)
      ) {
        throw this.lineageInvalid("Stored replacement lineage is inconsistent.");
      }
    }

    const executionReferences = await this.repository.countExecutionReferences(
      transaction,
      shopId,
      quote.items.map((item) => item.id),
    );
    if (executionReferences > 0) {
      throw this.guardFailed("Unapproved replacement scope cannot have execution evidence.");
    }

    const previousCommercial = approved
      .map((item) => `${item.scopeKey}:${item.unitPrice}`)
      .sort()
      .join("|");
    const currentCommercial = quote.items
      .map((item) => `${item.scopeKey}:${Number(item.unitPrice)}`)
      .sort()
      .join("|");
    if (previousCommercial === currentCommercial && binding.discount === quote.discount) {
      throw this.guardFailed("Replacement scope or price must change before sending.");
    }
    return carriedIds.length;
  }

  private parseApprovedSnapshot(value: Prisma.JsonValue): ApprovedSnapshotItem[] {
    if (!Array.isArray(value))
      throw this.lineageInvalid("The binding approval snapshot is invalid.");
    return value.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw this.lineageInvalid("The binding approval snapshot is invalid.");
      }
      const item = entry as Record<string, Prisma.JsonValue>;
      if (
        typeof item.id !== "string" ||
        typeof item.scopeKey !== "string" ||
        typeof item.kind !== "string" ||
        typeof item.description !== "string" ||
        typeof item.quantity !== "number" ||
        typeof item.quantityUnit !== "string" ||
        typeof item.unitPrice !== "number" ||
        typeof item.isOptional !== "boolean" ||
        !(item.approvalGroup === null || typeof item.approvalGroup === "string")
      ) {
        throw this.lineageInvalid("The binding approval snapshot is invalid.");
      }
      return item as unknown as ApprovedSnapshotItem;
    });
  }

  private normalizeIdentity(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("vi");
  }

  private normalizeGroup(value: string | null): string | null {
    return value ? this.normalizeIdentity(value) : null;
  }

  private async auditRejectedLineage(
    error: unknown,
    tenant: TenantContext,
    entityId: string,
  ): Promise<void> {
    if (!this.isLineageError(error)) return;
    await this.repository.appendLineageAudit({
      shopId: tenant.shopId,
      actorUserId: tenant.userId,
      entityId,
      requestId: tenant.requestId,
      accepted: false,
      reason: "invalid_scope_lineage",
    });
  }

  private isLineageError(error: unknown): boolean {
    if (!(error instanceof ApiException)) return false;
    const response = error.getResponse();
    return (
      typeof response === "object" &&
      response !== null &&
      "code" in response &&
      response.code === "QUOTE_SCOPE_LINEAGE_INVALID"
    );
  }

  private lineageInvalid(message: string): ApiException {
    return new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "QUOTE_SCOPE_LINEAGE_INVALID",
      message,
    );
  }

  private guardFailed(message: string): ApiException {
    return new ApiException(HttpStatus.CONFLICT, "REPAIR_ORDER_GUARD_FAILED", message);
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
