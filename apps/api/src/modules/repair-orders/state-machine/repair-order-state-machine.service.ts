/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { ActorType, MembershipRole, RepairOrderStatus } from "@prisma/client";

import { ApiException } from "../../../common/api-exception.js";
import { IdempotencyService } from "../../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../../common/tenant/tenant-context.js";
import { toRepairOrderView, type RepairOrderResponse } from "../repair-order.types.js";
import type { TransitionRepairOrderDto } from "./transition-repair-order.dto.js";
import { isSupportedTransition } from "./repair-order-transition-graph.js";
import {
  RepairOrderStateMachineRepository,
  type TransitionOrderRecord,
} from "./repair-order-state-machine.repository.js";
import type {
  RepairOrderTransitionCommand,
  TransactionClient,
} from "./repair-order-state-machine.types.js";

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

    this.assertAllowedEdge(order.status, command.targetStatus);
    this.assertPermission(order.status, command.targetStatus, command.actor.role);
    this.assertCompletionOutcome(command);
    this.assertGuards(order, command.targetStatus);

    const updated = await this.repository.updateStatus(transaction, command, order.status);
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

  private actorCanSee(
    assignedTechnicianUserId: string | undefined,
    command: RepairOrderTransitionCommand,
  ): boolean {
    return (
      command.actor.role !== MembershipRole.TECHNICIAN ||
      assignedTechnicianUserId === command.actor.userId
    );
  }

  private assertAllowedEdge(from: RepairOrderStatus, to: RepairOrderStatus): void {
    if (!isSupportedTransition(from, to)) {
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
    role: MembershipRole | null,
  ): void {
    const permitted =
      role === MembershipRole.OWNER ||
      (from === RepairOrderStatus.RECEIVED &&
        to === RepairOrderStatus.DIAGNOSING &&
        role === MembershipRole.TECHNICIAN) ||
      (from === RepairOrderStatus.AWAITING_APPROVAL &&
        to === RepairOrderStatus.DIAGNOSING &&
        role === MembershipRole.RECEPTIONIST);
    if (!permitted) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "PERMISSION_DENIED",
        "You do not have permission to perform this transition.",
      );
    }
  }

  private assertCompletionOutcome(command: RepairOrderTransitionCommand): void {
    if (command.completionOutcome !== null && command.completionOutcome !== undefined) {
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

  private assertGuards(order: TransitionOrderRecord, targetStatus: RepairOrderStatus): void {
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
