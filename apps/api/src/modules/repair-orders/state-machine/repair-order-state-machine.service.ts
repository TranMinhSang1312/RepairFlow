/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ActorType,
  CompletionOutcome,
  MembershipRole,
  PartRequirementStatus,
  QcRunResult,
  QuoteDecision,
  QuoteItemKind,
  QuoteStatus,
  RepairOrderStatus,
  WorkLogType,
} from "@prisma/client";

import { ApiException } from "../../../common/api-exception.js";
import { IdempotencyService } from "../../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../../common/tenant/tenant-context.js";
import { toRepairOrderView, type RepairOrderResponse } from "../repair-order.types.js";
import type { TransitionRepairOrderDto } from "./transition-repair-order.dto.js";
import {
  isSupportedTransition,
  RepairOrderTransitionSource,
} from "./repair-order-transition-graph.js";
import {
  RepairOrderStateMachineRepository,
  type TransitionOrderRecord,
} from "./repair-order-state-machine.repository.js";
import type {
  InternalRepairOrderTransitionCommand,
  RepairOrderTransitionCommand,
  TransactionClient,
} from "./repair-order-state-machine.types.js";

interface ApprovedScopeItem {
  id: string;
  scopeKey: string;
  kind: QuoteItemKind;
}

@Injectable()
export class RepairOrderStateMachineService {
  constructor(
    private readonly repository: RepairOrderStateMachineRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  transition(
    tenant: TenantContext,
    repairOrderId: string,
    dto: TransitionRepairOrderDto,
    idempotencyKey: string | undefined,
  ): Promise<RepairOrderResponse> {
    if (!this.isUuid(repairOrderId)) {
      throw this.notFound();
    }

    const command: RepairOrderTransitionCommand = {
      shopId: tenant.shopId,
      repairOrderId: repairOrderId.toLowerCase(),
      targetStatus: dto.targetStatus,
      completionOutcome: dto.completionOutcome ?? null,
      reason: dto.reason || null,
      expectedLockVersion: dto.expectedLockVersion,
      source: RepairOrderTransitionSource.DIRECT,
      actor: { type: ActorType.USER, userId: tenant.userId, role: tenant.role },
      requestId: tenant.requestId,
    };

    return this.idempotency.execute({
      tenant,
      scope: "repair-orders.transition",
      key: idempotencyKey,
      request: {
        repairOrderId: command.repairOrderId,
        targetStatus: command.targetStatus,
        completionOutcome: command.completionOutcome,
        reason: command.reason,
        expectedLockVersion: command.expectedLockVersion,
      },
      responseStatus: HttpStatus.OK,
      operation: async (transaction) => ({
        data: toRepairOrderView(await this.transitionInTransaction(transaction, command)),
      }),
    });
  }

  async transitionInTransaction(
    transaction: TransactionClient,
    command: RepairOrderTransitionCommand,
  ) {
    await this.repository.lock(transaction, command.shopId, command.repairOrderId);
    const order = await this.repository.findForTransition(
      transaction,
      command.shopId,
      command.repairOrderId,
    );
    if (!order || !this.actorCanSee(order.assignments[0]?.technicianUserId, command)) {
      throw this.notFound();
    }
    if (order.lockVersion !== command.expectedLockVersion) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "CONCURRENT_UPDATE",
        "The repair order was changed by another request.",
      );
    }

    this.assertAllowedEdge(order.status, command.targetStatus, command.source);
    this.assertPermission(order.status, command.targetStatus, command);
    this.assertCompletionOutcome(order.status, command);
    this.assertGuards(order, command);

    const updated = await this.repository.updateStatus(transaction, command, order);
    if (!updated) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "CONCURRENT_UPDATE",
        "The repair order was changed by another request.",
      );
    }
    await this.repository.appendEvent(transaction, command, order.status);

    const result = await this.repository.findForTransition(
      transaction,
      command.shopId,
      command.repairOrderId,
    );
    if (!result) {
      throw this.notFound();
    }
    return result;
  }

  transitionAfterQuoteSend(
    transaction: TransactionClient,
    command: InternalRepairOrderTransitionCommand,
  ) {
    return this.transitionInTransaction(transaction, {
      ...command,
      source: RepairOrderTransitionSource.QUOTE_SEND,
    });
  }

  transitionAfterQuoteDecision(
    transaction: TransactionClient,
    command: InternalRepairOrderTransitionCommand,
  ) {
    return this.transitionInTransaction(transaction, {
      ...command,
      source: RepairOrderTransitionSource.QUOTE_DECISION,
    });
  }

  transitionAfterQcFailure(
    transaction: TransactionClient,
    command: InternalRepairOrderTransitionCommand & { evidenceId: string },
  ) {
    return this.transitionInTransaction(transaction, {
      ...command,
      source: RepairOrderTransitionSource.QC_RUN,
    });
  }

  async advanceAfterQcPass(
    transaction: TransactionClient,
    command: InternalRepairOrderTransitionCommand & { evidenceId: string },
  ) {
    const qcCommand: RepairOrderTransitionCommand = {
      ...command,
      source: RepairOrderTransitionSource.QC_RUN,
    };
    await this.repository.lock(transaction, command.shopId, command.repairOrderId);
    const order = await this.repository.findForTransition(
      transaction,
      command.shopId,
      command.repairOrderId,
    );
    if (!order || !this.actorCanSee(order.assignments[0]?.technicianUserId, qcCommand)) {
      throw this.notFound();
    }
    if (order.lockVersion !== command.expectedLockVersion) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "CONCURRENT_UPDATE",
        "The repair order was changed by another request.",
      );
    }
    if (
      order.status !== RepairOrderStatus.QUALITY_CHECK ||
      command.targetStatus !== RepairOrderStatus.QUALITY_CHECK
    ) {
      throw this.guardFailed("A passing QC run can only advance an order in quality check.");
    }
    if (
      command.actor.role !== MembershipRole.OWNER &&
      command.actor.role !== MembershipRole.TECHNICIAN
    ) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "PERMISSION_DENIED",
        "You do not have permission to submit quality control.",
      );
    }
    const latest = order.qcRuns[0];
    if (!latest || latest.id !== command.evidenceId || latest.result !== QcRunResult.PASS) {
      throw this.guardFailed("A staged passing QC run is required.");
    }
    if (!(await this.repository.incrementLockVersionForQcPass(transaction, qcCommand))) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "CONCURRENT_UPDATE",
        "The repair order was changed by another request.",
      );
    }
    const updated = await this.repository.findForTransition(
      transaction,
      command.shopId,
      command.repairOrderId,
    );
    if (!updated) throw this.notFound();
    return updated;
  }

  transitionAfterHandover(
    transaction: TransactionClient,
    command: InternalRepairOrderTransitionCommand & { evidenceId: string },
  ) {
    return this.transitionInTransaction(transaction, {
      ...command,
      source: RepairOrderTransitionSource.HANDOVER,
    });
  }

  private actorCanSee(
    assignedTechnicianUserId: string | undefined,
    command: RepairOrderTransitionCommand,
  ): boolean {
    return (
      command.actor.role !== MembershipRole.TECHNICIAN ||
      assignedTechnicianUserId === command.actor.userId
    );
  }

  private assertAllowedEdge(
    from: RepairOrderStatus,
    to: RepairOrderStatus,
    source: RepairOrderTransitionCommand["source"],
  ): void {
    if (!isSupportedTransition(from, to, source)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "REPAIR_ORDER_INVALID_TRANSITION",
        `Transition from ${from} to ${to} is not allowed.`,
      );
    }
  }

  private assertPermission(
    from: RepairOrderStatus,
    to: RepairOrderStatus,
    command: RepairOrderTransitionCommand,
  ): void {
    const actor = command.actor;
    const directOwner =
      command.source === RepairOrderTransitionSource.DIRECT && actor.role === MembershipRole.OWNER;
    const assignedTechnicianTransition =
      command.source === RepairOrderTransitionSource.DIRECT &&
      actor.role === MembershipRole.TECHNICIAN &&
      ((from === RepairOrderStatus.RECEIVED && to === RepairOrderStatus.DIAGNOSING) ||
        (from === RepairOrderStatus.APPROVED && to === RepairOrderStatus.WAITING_PARTS) ||
        ((from === RepairOrderStatus.APPROVED || from === RepairOrderStatus.WAITING_PARTS) &&
          to === RepairOrderStatus.REPAIRING) ||
        (from === RepairOrderStatus.REPAIRING && to === RepairOrderStatus.QUALITY_CHECK) ||
        (from === RepairOrderStatus.QUALITY_CHECK && to === RepairOrderStatus.READY_FOR_PICKUP));
    const receptionistDirect =
      command.source === RepairOrderTransitionSource.DIRECT &&
      actor.role === MembershipRole.RECEPTIONIST &&
      ((from === RepairOrderStatus.AWAITING_APPROVAL && to === RepairOrderStatus.DIAGNOSING) ||
        (from === RepairOrderStatus.DIAGNOSING &&
          (to === RepairOrderStatus.AWAITING_APPROVAL ||
            to === RepairOrderStatus.READY_FOR_PICKUP)) ||
        (from === RepairOrderStatus.QUALITY_CHECK && to === RepairOrderStatus.READY_FOR_PICKUP));
    const quoteSender =
      command.source === RepairOrderTransitionSource.QUOTE_SEND &&
      (actor.role === MembershipRole.OWNER || actor.role === MembershipRole.RECEPTIONIST);
    const quoteDecision =
      command.source === RepairOrderTransitionSource.QUOTE_DECISION &&
      actor.type === ActorType.CUSTOMER_TOKEN;
    const qcCaller =
      command.source === RepairOrderTransitionSource.QC_RUN &&
      (actor.role === MembershipRole.OWNER || actor.role === MembershipRole.TECHNICIAN);
    const handoverCaller =
      command.source === RepairOrderTransitionSource.HANDOVER &&
      (actor.role === MembershipRole.OWNER || actor.role === MembershipRole.RECEPTIONIST);
    const permitted =
      directOwner ||
      assignedTechnicianTransition ||
      receptionistDirect ||
      quoteSender ||
      quoteDecision ||
      qcCaller ||
      handoverCaller;
    if (!permitted) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "PERMISSION_DENIED",
        "You do not have permission to perform this transition.",
      );
    }
  }

  private assertCompletionOutcome(
    from: RepairOrderStatus,
    command: RepairOrderTransitionCommand,
  ): void {
    let allowed: ReadonlySet<CompletionOutcome> | null = null;
    if (
      from === RepairOrderStatus.AWAITING_APPROVAL &&
      command.source === RepairOrderTransitionSource.QUOTE_DECISION
    ) {
      allowed = new Set([CompletionOutcome.DECLINED_QUOTE]);
    } else if (
      from === RepairOrderStatus.DIAGNOSING &&
      command.source === RepairOrderTransitionSource.DIRECT
    ) {
      allowed = new Set([
        CompletionOutcome.UNREPAIRABLE,
        CompletionOutcome.NO_FAULT_FOUND,
        CompletionOutcome.CUSTOMER_CANCELLED,
      ]);
    } else if (
      from === RepairOrderStatus.QUALITY_CHECK &&
      command.source === RepairOrderTransitionSource.DIRECT
    ) {
      allowed = new Set([CompletionOutcome.REPAIRED]);
    }

    if (
      command.targetStatus === RepairOrderStatus.READY_FOR_PICKUP &&
      !allowed?.has(command.completionOutcome!)
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "COMPLETION_OUTCOME_REQUIRED",
        "The exact completion outcome required by this transition must be supplied.",
      );
    }
    if (
      command.targetStatus !== RepairOrderStatus.READY_FOR_PICKUP &&
      command.completionOutcome !== null &&
      command.completionOutcome !== undefined
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "One or more input fields are invalid.",
        [
          {
            field: "completionOutcome",
            code: "NOT_ALLOWED",
            message: "completionOutcome is not allowed for this target status.",
          },
        ],
      );
    }
  }

  private assertGuards(order: TransitionOrderRecord, command: RepairOrderTransitionCommand): void {
    const targetStatus = command.targetStatus;
    if (
      order.status === RepairOrderStatus.RECEIVED &&
      targetStatus === RepairOrderStatus.DIAGNOSING
    ) {
      if (!order.intakeCondition.trim()) {
        throw this.guardFailed("The intake condition is required before diagnosis can start.");
      }
      if (order.media.length < order.shop.intakePhotoMinimum) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "INTAKE_PHOTOS_REQUIRED",
          "The configured intake photo minimum has not been met.",
        );
      }
      if (!order.assignments[0]) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "TECHNICIAN_NOT_ASSIGNED",
          "An active technician assignment is required.",
        );
      }
    }

    if (order.status === RepairOrderStatus.RECEIVED && targetStatus === RepairOrderStatus.VOIDED) {
      const hasHistory =
        order._count.quoteVersions > 0 || order._count.payments > 0 || order._count.workLogs > 0;
      if (hasHistory) {
        throw this.guardFailed("An order with quote, payment, or work history cannot be voided.");
      }
    }

    if (
      order.status === RepairOrderStatus.DIAGNOSING &&
      targetStatus === RepairOrderStatus.READY_FOR_PICKUP
    ) {
      if (command.completionOutcome === CompletionOutcome.CUSTOMER_CANCELLED) {
        if (!command.reason?.trim()) {
          throw this.guardFailed("A cancellation note is required.");
        }
        const quoteWasSentOrAccepted = order.quoteVersions.some(
          (quote) =>
            quote.sentAt !== null ||
            quote.status === QuoteStatus.SENT ||
            quote.status === QuoteStatus.ACCEPTED ||
            quote.status === QuoteStatus.PARTIALLY_ACCEPTED ||
            quote.status === QuoteStatus.DECLINED ||
            quote.status === QuoteStatus.SUPERSEDED,
        );
        const technicalWorkExists = order.workLogs.some(
          (workLog) => this.workLogSemanticType(order.workLogs, workLog) !== null,
        );
        if (
          quoteWasSentOrAccepted ||
          order._count.payments > 0 ||
          technicalWorkExists ||
          order._count.partsUsed > 0
        ) {
          throw this.guardFailed(
            "A cancellation is unavailable after quote, payment, technical work, or part usage.",
          );
        }
      } else if (order.diagnoses.length === 0) {
        throw this.guardFailed("A diagnosis is required before this non-repair outcome.");
      }
    }

    if (
      (order.status === RepairOrderStatus.DIAGNOSING ||
        order.status === RepairOrderStatus.REPAIRING) &&
      targetStatus === RepairOrderStatus.AWAITING_APPROVAL &&
      !order.quoteVersions.some(
        (quote) => quote.status === QuoteStatus.SENT && quote.items.length > 0,
      )
    ) {
      throw this.guardFailed("A sent quote with at least one item is required for approval.");
    }

    const currentQuote = order.quoteVersions.find(
      (quote) =>
        quote.approval &&
        (quote.status === QuoteStatus.ACCEPTED ||
          quote.status === QuoteStatus.PARTIALLY_ACCEPTED ||
          quote.status === QuoteStatus.DECLINED),
    );
    if (
      order.status === RepairOrderStatus.AWAITING_APPROVAL &&
      targetStatus === RepairOrderStatus.APPROVED &&
      (!currentQuote ||
        (currentQuote.status !== QuoteStatus.ACCEPTED &&
          currentQuote.status !== QuoteStatus.PARTIALLY_ACCEPTED) ||
        !currentQuote.approval ||
        (currentQuote.approval.decision !== QuoteDecision.ACCEPTED &&
          currentQuote.approval.decision !== QuoteDecision.PARTIALLY_ACCEPTED))
    ) {
      throw this.guardFailed("An accepted current quote is required before repair approval.");
    }
    if (
      order.status === RepairOrderStatus.AWAITING_APPROVAL &&
      targetStatus === RepairOrderStatus.READY_FOR_PICKUP &&
      (!currentQuote ||
        currentQuote.status !== QuoteStatus.DECLINED ||
        currentQuote.approval?.decision !== QuoteDecision.DECLINED)
    ) {
      throw this.guardFailed("A declined current quote is required before pickup.");
    }

    if (
      order.status === RepairOrderStatus.APPROVED &&
      targetStatus === RepairOrderStatus.WAITING_PARTS
    ) {
      const scope = this.approvedScope(order);
      const partScopes = new Set(
        scope.filter((item) => item.kind === QuoteItemKind.PART).map((item) => item.scopeKey),
      );
      const hasUnavailableRequirement = order.partRequirements.some(
        (requirement) =>
          partScopes.has(requirement.scopeKey) &&
          requirement.status !== PartRequirementStatus.AVAILABLE &&
          requirement.status !== PartRequirementStatus.CANCELLED,
      );
      if (!hasUnavailableRequirement) {
        throw this.guardFailed("A current approved part must be unavailable before waiting.");
      }
    }

    if (
      (order.status === RepairOrderStatus.APPROVED ||
        order.status === RepairOrderStatus.WAITING_PARTS) &&
      targetStatus === RepairOrderStatus.REPAIRING
    ) {
      if (!order.assignments[0]) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "TECHNICIAN_NOT_ASSIGNED",
          "An active technician assignment is required.",
        );
      }
      const scope = this.approvedScope(order);
      if (scope.length === 0) {
        throw this.guardFailed("A non-empty approved scope is required before repair starts.");
      }
      for (const part of scope.filter((item) => item.kind === QuoteItemKind.PART)) {
        const available = order.partRequirements.filter(
          (requirement) =>
            requirement.scopeKey === part.scopeKey &&
            requirement.status === PartRequirementStatus.AVAILABLE,
        );
        if (available.length !== 1) {
          throw this.guardFailed("Every current approved part must be available before repair.");
        }
      }
    }

    if (
      order.status === RepairOrderStatus.REPAIRING &&
      targetStatus === RepairOrderStatus.QUALITY_CHECK
    ) {
      const actionable = this.approvedScope(order).filter(
        (item) => item.kind === QuoteItemKind.SERVICE || item.kind === QuoteItemKind.PART,
      );
      const coveredScopes = this.effectiveTechnicalScopes(order.workLogs);
      if (actionable.some((item) => !coveredScopes.has(item.scopeKey))) {
        throw this.guardFailed("Effective technical work is required for every approved item.");
      }
    }

    if (
      order.status === RepairOrderStatus.QUALITY_CHECK &&
      targetStatus === RepairOrderStatus.READY_FOR_PICKUP &&
      order.qcRuns[0]?.result !== QcRunResult.PASS
    ) {
      throw this.guardFailed("The latest QC run must pass before the order is ready.");
    }

    if (
      command.source === RepairOrderTransitionSource.QC_RUN &&
      !this.isValidFailedQcEvidence(order, command.evidenceId)
    ) {
      throw this.guardFailed("A staged failed QC run with notes is required.");
    }

    if (
      command.source === RepairOrderTransitionSource.HANDOVER &&
      (!order.handover || order.handover.id !== command.evidenceId)
    ) {
      throw this.guardFailed("A staged handover is required before completion.");
    }
  }

  private approvedScope(order: TransitionOrderRecord): ApprovedScopeItem[] {
    const binding = order.quoteVersions.find(
      (quote) =>
        (quote.status === QuoteStatus.ACCEPTED ||
          quote.status === QuoteStatus.PARTIALLY_ACCEPTED) &&
        quote.approval,
    );
    const snapshot = binding?.approval?.approvedItemSnapshot;
    if (!Array.isArray(snapshot)) {
      throw this.guardFailed("A binding approved scope is required.");
    }
    const items: ApprovedScopeItem[] = [];
    const ids = new Set<string>();
    const scopeKeys = new Set<string>();
    for (const value of snapshot) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw this.guardFailed("The approved scope is invalid.");
      }
      const item = value as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        typeof item.scopeKey !== "string" ||
        !Object.values(QuoteItemKind).includes(item.kind as QuoteItemKind) ||
        ids.has(item.id) ||
        scopeKeys.has(item.scopeKey)
      ) {
        throw this.guardFailed("The approved scope is invalid.");
      }
      ids.add(item.id);
      scopeKeys.add(item.scopeKey);
      items.push({ id: item.id, scopeKey: item.scopeKey, kind: item.kind as QuoteItemKind });
    }
    return items;
  }

  private effectiveTechnicalScopes(logs: TransitionOrderRecord["workLogs"]): ReadonlySet<string> {
    const supersededIds = new Set(
      logs.flatMap((log) => (log.supersedesId ? [log.supersedesId] : [])),
    );
    const scopes = new Set<string>();
    for (const log of logs.filter((candidate) => !supersededIds.has(candidate.id))) {
      const scopeKey = this.workLogScope(logs, log);
      if (this.workLogSemanticType(logs, log) && scopeKey) {
        scopes.add(scopeKey);
      }
    }
    return scopes;
  }

  private workLogSemanticType(
    logs: TransitionOrderRecord["workLogs"],
    log: TransitionOrderRecord["workLogs"][number],
  ): WorkLogType | null {
    let current = log;
    const seen = new Set<string>();
    while (current.type === WorkLogType.CORRECTION && current.supersedesId) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      const previous = logs.find((candidate) => candidate.id === current.supersedesId);
      if (!previous) return null;
      current = previous;
    }
    return current.type === WorkLogType.REPAIR || current.type === WorkLogType.TEST
      ? current.type
      : null;
  }

  private workLogScope(
    logs: TransitionOrderRecord["workLogs"],
    log: TransitionOrderRecord["workLogs"][number],
  ): string | null {
    let current = log;
    const seen = new Set<string>();
    while (!current.quoteItem?.scopeKey && current.supersedesId) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      const previous = logs.find((candidate) => candidate.id === current.supersedesId);
      if (!previous) return null;
      current = previous;
    }
    return current.quoteItem?.scopeKey ?? null;
  }

  private isValidFailedQcEvidence(
    order: TransitionOrderRecord,
    evidenceId: string | null | undefined,
  ): boolean {
    const latest = order.qcRuns[0];
    return Boolean(
      latest &&
      latest.id === evidenceId &&
      latest.result === QcRunResult.FAIL &&
      latest.notes?.trim(),
    );
  }

  private guardFailed(message: string): ApiException {
    return new ApiException(HttpStatus.CONFLICT, "REPAIR_ORDER_GUARD_FAILED", message);
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
