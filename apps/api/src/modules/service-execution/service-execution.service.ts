/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  MembershipRole,
  PartRequirementStatus,
  Prisma,
  QuoteItemKind,
  RepairOrderStatus,
  WorkLogType,
} from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import type {
  CreatePartRequirementDto,
  CreatePartUsedDto,
  CreateWorkLogDto,
  UpdatePartRequirementDto,
} from "./service-execution.dto.js";
import {
  type ExecutionOrderRecord,
  ServiceExecutionRepository,
} from "./service-execution.repository.js";
import {
  parseApprovedScope,
  toPartRequirementView,
  toPartUsedViews,
  toWorkLogViews,
  type ApprovedScopeItem,
  type ApprovedScopeSummary,
  type PartRequirementResponse,
  type PartUsedResponse,
  type WorkLogResponse,
  type WorkLogRecord,
} from "./service-execution.types.js";

const OPERATIONAL_STATES = new Set<RepairOrderStatus>([
  RepairOrderStatus.APPROVED,
  RepairOrderStatus.WAITING_PARTS,
  RepairOrderStatus.REPAIRING,
  RepairOrderStatus.QUALITY_CHECK,
  RepairOrderStatus.READY_FOR_PICKUP,
]);

const REQUIREMENT_STATES = new Set<RepairOrderStatus>([
  RepairOrderStatus.APPROVED,
  RepairOrderStatus.WAITING_PARTS,
  RepairOrderStatus.REPAIRING,
]);

const TECHNICAL_LOG_TYPES = new Set<WorkLogType>([WorkLogType.REPAIR, WorkLogType.TEST]);

@Injectable()
export class ServiceExecutionService {
  constructor(
    private readonly repository: ServiceExecutionRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  createWorkLog(
    tenant: TenantContext,
    repairOrderId: string,
    dto: CreateWorkLogDto,
    idempotencyKey: string | undefined,
  ): Promise<WorkLogResponse> {
    const orderId = this.normalizedUuidOrNotFound(repairOrderId);
    const request = {
      repairOrderId: orderId,
      type: dto.type,
      content: dto.content,
      quoteItemId: dto.quoteItemId?.toLowerCase() ?? null,
      supersedesId: dto.supersedesId?.toLowerCase() ?? null,
    };

    return this.idempotency.execute({
      tenant,
      scope: "service-execution.work-logs.create",
      key: idempotencyKey,
      request,
      operation: async (transaction) => {
        const order = await this.lockAndLoadOrder(transaction, tenant, orderId);
        let quoteItemId: string | null = null;
        let effectiveType = request.type;
        let scopeKey: string | null = null;

        if (request.type === WorkLogType.CORRECTION) {
          if (request.quoteItemId) {
            throw this.validationFailed(
              "quoteItemId",
              "NOT_ALLOWED",
              "quoteItemId is derived from the correction target.",
            );
          }
          const correction = this.resolveWorkLogCorrection(order.workLogs, request.supersedesId);
          effectiveType = correction.root.type;
          quoteItemId = correction.root.quoteItemId;
          scopeKey = correction.root.quoteItem?.scopeKey ?? null;
          this.assertWorkLogState(order.status, effectiveType);
          if (TECHNICAL_LOG_TYPES.has(effectiveType)) {
            this.requireApprovedScopeKey(this.requiredApprovedScope(order), scopeKey, [
              QuoteItemKind.SERVICE,
              QuoteItemKind.PART,
            ]);
          }
        } else {
          if (request.supersedesId) {
            throw this.validationFailed(
              "supersedesId",
              "NOT_ALLOWED",
              "supersedesId is allowed only for CORRECTION.",
            );
          }
          this.assertWorkLogState(order.status, request.type);
          if (TECHNICAL_LOG_TYPES.has(request.type)) {
            const item = this.requireApprovedItem(
              this.requiredApprovedScope(order),
              request.quoteItemId,
              [QuoteItemKind.SERVICE, QuoteItemKind.PART],
            );
            quoteItemId = item.quoteItemId;
            scopeKey = item.scopeKey;
          } else if (request.quoteItemId) {
            throw this.validationFailed(
              "quoteItemId",
              "NOT_ALLOWED",
              "Operational notes cannot be bound to approved scope.",
            );
          }
        }

        const created = await this.repository.createWorkLog(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          quoteItemId,
          supersedesId: request.supersedesId,
          type: request.type,
          content: request.content,
          actorUserId: tenant.userId,
        });
        await this.repository.appendEvent(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          eventType: "WORK_LOG_RECORDED",
          actorUserId: tenant.userId,
          requestId: tenant.requestId,
          publicPayload:
            effectiveType === WorkLogType.INTERNAL_NOTE
              ? Prisma.JsonNull
              : {
                  message: TECHNICAL_LOG_TYPES.has(effectiveType)
                    ? "Repair progress was recorded."
                    : "Customer contact was recorded.",
                },
          privatePayload: {
            workLogId: created.id,
            type: created.type,
            effectiveType,
            quoteItemId,
            scopeKey,
            supersedesId: created.supersedesId,
            content: created.content,
          },
        });
        const view = toWorkLogViews([...order.workLogs, created]).find(
          (candidate) => candidate.id === created.id,
        );
        if (!view) throw new Error("Created work log could not be mapped");
        return { data: view };
      },
    });
  }

  createPartRequirement(
    tenant: TenantContext,
    repairOrderId: string,
    dto: CreatePartRequirementDto,
    idempotencyKey: string | undefined,
  ): Promise<PartRequirementResponse> {
    const orderId = this.normalizedUuidOrNotFound(repairOrderId);
    const request = {
      repairOrderId: orderId,
      quoteItemId: dto.quoteItemId.toLowerCase(),
      sku: dto.sku?.trim() || null,
    };

    return this.idempotency.execute({
      tenant,
      scope: "service-execution.part-requirements.create",
      key: idempotencyKey,
      request,
      operation: async (transaction) => {
        const order = await this.lockAndLoadOrder(transaction, tenant, orderId);
        this.assertStateIn(
          order.status,
          REQUIREMENT_STATES,
          "Part requirements cannot be changed in the current order state.",
        );
        const scope = this.requiredApprovedScope(order);
        const item = this.requireApprovedItem(scope, request.quoteItemId, [QuoteItemKind.PART]);
        if (
          order.partRequirements.some(
            (requirement) =>
              requirement.scopeKey === item.scopeKey &&
              requirement.status !== PartRequirementStatus.CANCELLED,
          )
        ) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "PART_REQUIREMENT_INVALID_TRANSITION",
            "A current requirement already exists for this approved part.",
          );
        }

        const created = await this.repository.createPartRequirement(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          quoteItemId: item.quoteItemId,
          scopeKey: item.scopeKey,
          nameSnapshot: item.description,
          sku: request.sku,
          quantity: new Prisma.Decimal(item.quantity.toString()),
          quantityUnit: item.quantityUnit,
          actorUserId: tenant.userId,
        });
        await this.repository.appendEvent(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          eventType: "PART_REQUIREMENT_CREATED",
          actorUserId: tenant.userId,
          requestId: tenant.requestId,
          publicPayload: { message: "A required part is being coordinated." },
          privatePayload: {
            partRequirementId: created.id,
            quoteItemId: created.quoteItemId,
            scopeKey: created.scopeKey,
            status: created.status,
          },
        });
        return { data: toPartRequirementView(created) };
      },
    });
  }

  updatePartRequirement(
    tenant: TenantContext,
    partRequirementId: string,
    dto: UpdatePartRequirementDto,
    idempotencyKey: string | undefined,
  ): Promise<PartRequirementResponse> {
    const requirementId = this.normalizedUuidOrNotFound(partRequirementId);
    const request = {
      partRequirementId: requirementId,
      targetStatus: dto.targetStatus,
      expectedLockVersion: dto.expectedLockVersion,
    };

    return this.idempotency.execute({
      tenant,
      scope: "service-execution.part-requirements.update",
      key: idempotencyKey,
      request,
      responseStatus: HttpStatus.OK,
      operation: async (transaction) => {
        const preliminary = await this.repository.findRequirement(
          transaction,
          tenant.shopId,
          requirementId,
        );
        if (!preliminary) throw this.notFound();
        const order = await this.lockAndLoadOrder(transaction, tenant, preliminary.repairOrderId);
        this.assertStateIn(
          order.status,
          REQUIREMENT_STATES,
          "Part requirements cannot be changed in the current order state.",
        );
        const requirement = order.partRequirements.find(
          (candidate) => candidate.id === requirementId,
        );
        if (!requirement) throw this.notFound();
        this.requireApprovedScopeKey(this.requiredApprovedScope(order), requirement.scopeKey, [
          QuoteItemKind.PART,
        ]);
        if (requirement.lockVersion !== request.expectedLockVersion) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "CONCURRENT_UPDATE",
            "The part requirement was changed by another request.",
          );
        }
        if (!this.isAllowedRequirementEdge(requirement.status, request.targetStatus)) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "PART_REQUIREMENT_INVALID_TRANSITION",
            "The requested part availability transition is not allowed.",
          );
        }

        const updated = await this.repository.updatePartRequirement(transaction, {
          shopId: tenant.shopId,
          id: requirement.id,
          currentStatus: requirement.status,
          targetStatus: request.targetStatus,
          expectedLockVersion: request.expectedLockVersion,
          actorUserId: tenant.userId,
        });
        if (!updated) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "CONCURRENT_UPDATE",
            "The part requirement was changed by another request.",
          );
        }
        await this.repository.appendEvent(transaction, {
          shopId: tenant.shopId,
          repairOrderId: order.id,
          eventType: "PART_REQUIREMENT_UPDATED",
          actorUserId: tenant.userId,
          requestId: tenant.requestId,
          publicPayload: {
            message:
              updated.status === PartRequirementStatus.AVAILABLE
                ? "A required part is available."
                : "A required part was ordered.",
          },
          privatePayload: {
            partRequirementId: updated.id,
            fromStatus: requirement.status,
            toStatus: updated.status,
            lockVersion: updated.lockVersion,
          },
        });
        return { data: toPartRequirementView(updated) };
      },
    });
  }

  createPartUsed(
    tenant: TenantContext,
    repairOrderId: string,
    dto: CreatePartUsedDto,
    idempotencyKey: string | undefined,
  ): Promise<PartUsedResponse> {
    const orderId = this.normalizedUuidOrNotFound(repairOrderId);
    const request = {
      repairOrderId: orderId,
      quoteItemId: dto.quoteItemId.toLowerCase(),
      name: dto.name,
      sku: dto.sku?.trim() || null,
      quantity: dto.quantity,
      unitCost: dto.unitCost ?? null,
      unitSalePrice: dto.unitSalePrice ?? null,
      supersedesId: dto.supersedesId?.toLowerCase() ?? null,
    };

    return this.idempotency.execute({
      tenant,
      scope: "service-execution.parts-used.create",
      key: idempotencyKey,
      request,
      operation: async (transaction) => {
        const order = await this.lockAndLoadOrder(transaction, tenant, orderId);
        this.assertStateIn(
          order.status,
          new Set([RepairOrderStatus.REPAIRING]),
          "Used parts can only be recorded while the order is being repaired.",
        );
        const scope = this.requiredApprovedScope(order);
        const item = this.requireApprovedItem(scope, request.quoteItemId, [QuoteItemKind.PART]);
        if (request.unitSalePrice !== null && request.unitSalePrice !== item.unitPrice) {
          throw this.guardFailed(
            "The used-part sale price must match the current approved quote item.",
          );
        }
        let replacedId: string | null = null;
        if (request.supersedesId) {
          const target = order.partsUsed.find((part) => part.id === request.supersedesId);
          if (!target) throw this.notFound();
          const isLeaf = !order.partsUsed.some((part) => part.supersedesId === target.id);
          if (!isLeaf || target.scopeKey !== item.scopeKey) {
            throw this.guardFailed(
              "The used-part correction target is not a current matching leaf.",
            );
          }
          replacedId = target.id;
        }

        const supersededIds = new Set(
          order.partsUsed.flatMap((part) => (part.supersedesId ? [part.supersedesId] : [])),
        );
        let effectiveQuantity = new Prisma.Decimal(0);
        for (const part of order.partsUsed) {
          if (
            part.scopeKey === item.scopeKey &&
            !supersededIds.has(part.id) &&
            part.id !== replacedId
          ) {
            effectiveQuantity = effectiveQuantity.plus(part.quantity);
          }
        }
        const quantity = new Prisma.Decimal(request.quantity.toString());
        if (
          effectiveQuantity.plus(quantity).greaterThan(new Prisma.Decimal(item.quantity.toString()))
        ) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "PART_QUANTITY_EXCEEDED",
            "Effective used quantity exceeds the approved quantity.",
          );
        }

        const created = await this.repository.createPartUsed(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          quoteItemId: item.quoteItemId,
          scopeKey: item.scopeKey,
          supersedesId: request.supersedesId,
          name: request.name,
          sku: request.sku,
          quantity,
          unitCost: request.unitCost === null ? null : BigInt(request.unitCost),
          unitSalePrice: request.unitSalePrice === null ? null : BigInt(request.unitSalePrice),
          actorUserId: tenant.userId,
        });
        await this.repository.appendEvent(transaction, {
          shopId: tenant.shopId,
          repairOrderId: orderId,
          eventType: "PART_USED_RECORDED",
          actorUserId: tenant.userId,
          requestId: tenant.requestId,
          publicPayload: { message: "A repair part was recorded." },
          privatePayload: {
            partUsedId: created.id,
            quoteItemId: created.quoteItemId,
            scopeKey: created.scopeKey,
            supersedesId: created.supersedesId,
            quantity: Number(created.quantity.toString()),
            unitCost: request.unitCost,
            unitSalePrice: request.unitSalePrice,
          },
        });
        const view = toPartUsedViews([...order.partsUsed, created]).find(
          (candidate) => candidate.id === created.id,
        );
        if (!view) throw new Error("Created used part could not be mapped");
        return { data: view };
      },
    });
  }

  private async lockAndLoadOrder(
    transaction: Prisma.TransactionClient,
    tenant: TenantContext,
    repairOrderId: string,
  ): Promise<ExecutionOrderRecord> {
    await this.repository.lock(transaction, tenant.shopId, repairOrderId);
    const order = await this.repository.findOrder(transaction, tenant.shopId, repairOrderId);
    if (
      !order ||
      (tenant.role === MembershipRole.TECHNICIAN &&
        order.assignments[0]?.technicianUserId !== tenant.userId)
    ) {
      throw this.notFound();
    }
    if (tenant.role === MembershipRole.RECEPTIONIST) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "PERMISSION_DENIED",
        "You do not have permission to change service execution records.",
      );
    }
    return order;
  }

  private requiredApprovedScope(order: ExecutionOrderRecord): ApprovedScopeSummary {
    const scope = parseApprovedScope(order.quoteVersions[0]);
    if (!scope) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "APPROVED_SCOPE_REQUIRED",
        "A binding approved scope is required.",
      );
    }
    return scope;
  }

  private requireApprovedItem(
    scope: ApprovedScopeSummary,
    quoteItemId: string | null,
    allowedKinds: QuoteItemKind[],
  ): ApprovedScopeItem {
    const item = quoteItemId
      ? scope.items.find((candidate) => candidate.quoteItemId === quoteItemId)
      : undefined;
    if (!item || !allowedKinds.includes(item.kind)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "APPROVED_ITEM_REQUIRED",
        "The referenced item is not in the current approved scope.",
      );
    }
    return item;
  }

  private requireApprovedScopeKey(
    scope: ApprovedScopeSummary,
    scopeKey: string | null,
    allowedKinds: QuoteItemKind[],
  ): ApprovedScopeItem {
    const item = scopeKey
      ? scope.items.find((candidate) => candidate.scopeKey === scopeKey)
      : undefined;
    if (!item || !allowedKinds.includes(item.kind)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "APPROVED_ITEM_REQUIRED",
        "The referenced scope is not in the current approval.",
      );
    }
    return item;
  }

  private resolveWorkLogCorrection(
    logs: WorkLogRecord[],
    supersedesId: string | null,
  ): { root: WorkLogRecord } {
    if (!supersedesId) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "WORK_LOG_CORRECTION_INVALID",
        "A correction must identify the current effective leaf.",
      );
    }
    const byId = new Map(logs.map((log) => [log.id, log]));
    const target = byId.get(supersedesId);
    if (!target) throw this.notFound();
    if (logs.some((log) => log.supersedesId === target.id)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "WORK_LOG_CORRECTION_INVALID",
        "Only the current effective leaf can be corrected.",
      );
    }

    let root = target;
    const seen = new Set<string>();
    while (root.type === WorkLogType.CORRECTION) {
      if (!root.supersedesId || seen.has(root.id)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "WORK_LOG_CORRECTION_INVALID",
          "The correction chain is invalid.",
        );
      }
      seen.add(root.id);
      const parent = byId.get(root.supersedesId);
      if (!parent) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "WORK_LOG_CORRECTION_INVALID",
          "The correction chain is invalid.",
        );
      }
      root = parent;
    }
    return { root };
  }

  private assertWorkLogState(status: RepairOrderStatus, effectiveType: WorkLogType): void {
    if (TECHNICAL_LOG_TYPES.has(effectiveType)) {
      this.assertStateIn(
        status,
        new Set([RepairOrderStatus.REPAIRING]),
        "Technical work can only be recorded while the order is being repaired.",
      );
      return;
    }
    if (
      effectiveType !== WorkLogType.CUSTOMER_CONTACT &&
      effectiveType !== WorkLogType.INTERNAL_NOTE
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "WORK_LOG_CORRECTION_INVALID",
        "The work-log semantic type is invalid.",
      );
    }
    this.assertStateIn(
      status,
      OPERATIONAL_STATES,
      "Operational notes cannot be recorded in the current order state.",
    );
  }

  private assertStateIn(
    status: RepairOrderStatus,
    allowed: ReadonlySet<RepairOrderStatus>,
    message: string,
  ): void {
    if (!allowed.has(status)) throw this.guardFailed(message);
  }

  private isAllowedRequirementEdge(
    from: PartRequirementStatus,
    to: PartRequirementStatus,
  ): boolean {
    return (
      (from === PartRequirementStatus.NEEDED &&
        (to === PartRequirementStatus.ORDERED || to === PartRequirementStatus.AVAILABLE)) ||
      (from === PartRequirementStatus.ORDERED && to === PartRequirementStatus.AVAILABLE)
    );
  }

  private normalizedUuidOrNotFound(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw this.notFound();
    }
    return value.toLowerCase();
  }

  private validationFailed(field: string, code: string, message: string): ApiException {
    return new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "VALIDATION_FAILED",
      "One or more input fields are invalid.",
      [{ field, code, message }],
    );
  }

  private guardFailed(message: string): ApiException {
    return new ApiException(HttpStatus.CONFLICT, "REPAIR_ORDER_GUARD_FAILED", message);
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
