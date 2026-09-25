/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { CompletionOutcome, Prisma, RepairOrderStatus, ServiceType } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { RepairOrderIntakeService } from "../repair-orders/repair-order-intake.service.js";
import {
  toRepairOrderDetailView,
  type RepairOrderDetailResponse,
} from "../repair-orders/repair-order.types.js";
import type { CreateWarrantyFollowUpDto } from "./warranty-follow-up.dto.js";
import { WarrantiesRepository, type WarrantySource } from "./warranties.repository.js";

@Injectable()
export class WarrantiesService {
  constructor(
    private readonly repository: WarrantiesRepository,
    private readonly idempotency: IdempotencyService,
    private readonly intake: RepairOrderIntakeService,
  ) {}

  createFollowUp(
    tenant: TenantContext,
    sourceOrderId: string,
    dto: CreateWarrantyFollowUpDto,
    idempotencyKey: string | undefined,
  ): Promise<RepairOrderDetailResponse> {
    if (!this.isUuid(sourceOrderId)) throw this.notFound();

    const request = {
      sourceOrderId: sourceOrderId.toLowerCase(),
      eligibilityConfirmed: dto.eligibilityConfirmed,
      branchId: dto.branchId.toLowerCase(),
      priority: dto.priority,
      reportedProblem: dto.reportedProblem,
      intakeCondition: dto.intakeCondition,
      consentAccepted: dto.consentAccepted,
      promisedAt: dto.promisedAt ?? null,
      accessories: dto.accessories.map((item) => ({
        name: item.name,
        conditionNote: item.conditionNote ?? null,
      })),
      mediaAssetIds: [...dto.intakeMediaAssetIds].sort(),
    };
    this.intake.rejectDeviceCredentials(request);

    return this.idempotency.execute({
      tenant,
      scope: "warranty-orders.create",
      key: idempotencyKey,
      request,
      operation: async (transaction) => {
        if (!(await this.repository.lockSource(transaction, tenant, request.sourceOrderId))) {
          throw this.notFound();
        }
        const resources = await this.repository.loadIntakeResources(transaction, tenant, {
          ...request,
          actorUserId: tenant.userId,
        });
        if (!resources.shop || !resources.branchExists || !resources.source) {
          throw this.notFound();
        }
        if (!resources.actorAuthorized) {
          throw new ApiException(
            HttpStatus.FORBIDDEN,
            "PERMISSION_DENIED",
            "You do not have permission to perform this action.",
          );
        }
        this.assertSourceIdentity(resources.source, tenant.shopId);
        this.assertEligible(resources.source, request.eligibilityConfirmed, new Date());
        await this.intake.verifyMedia(
          resources.media,
          request.mediaAssetIds.length,
          resources.shop.intakePhotoMinimum,
        );

        const now = new Date();
        const identity = await this.intake.allocateIdentity(
          transaction,
          tenant,
          resources.shop,
          now,
        );
        const order = await this.intake.create(transaction, tenant, {
          branchId: request.branchId,
          customerId: resources.source.customerId,
          deviceId: resources.source.deviceId,
          ...identity,
          serviceType: ServiceType.WARRANTY,
          sourceOrderId: resources.source.id,
          priority: request.priority,
          reportedProblem: request.reportedProblem,
          intakeCondition: request.intakeCondition,
          promisedAt: request.promisedAt ? new Date(request.promisedAt) : null,
          consentAcknowledgedAt: now,
          customerSnapshot: this.copySnapshot(resources.source.customerSnapshot),
          deviceSnapshot: this.copySnapshot(resources.source.deviceSnapshot),
          accessories: request.accessories,
          mediaAssetIds: request.mediaAssetIds,
          actorUserId: tenant.userId,
          requestId: tenant.requestId,
          event: {
            eventType: "warranty_case.opened",
            publicPayload: {
              code: identity.code,
              status: RepairOrderStatus.RECEIVED,
              message: "The device was received for warranty service.",
            },
            privatePayload: {
              sourceOrderId: resources.source.id,
              branchId: request.branchId,
              mediaCount: request.mediaAssetIds.length,
            },
          },
        });
        const detail = await this.intake.detailInTransaction(transaction, tenant, order.id);
        if (!detail) throw this.notFound();
        return { data: toRepairOrderDetailView(detail) };
      },
    });
  }

  private assertSourceIdentity(source: WarrantySource, shopId: string): void {
    if (
      source.shopId !== shopId ||
      source.customer.shopId !== shopId ||
      source.device.shopId !== shopId ||
      source.device.customerId !== source.customerId
    ) {
      throw this.notFound();
    }
  }

  private assertEligible(source: WarrantySource, confirmed: boolean, now: Date): void {
    if (
      source.status !== RepairOrderStatus.COMPLETED ||
      source.completionOutcome !== CompletionOutcome.REPAIRED ||
      !source.warranty
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "WARRANTY_SOURCE_INVALID",
        "The source repair order is not eligible for a warranty follow-up.",
      );
    }
    if (
      !confirmed ||
      source.warranty.startsAt.getTime() > now.getTime() ||
      source.warranty.endsAt.getTime() <= now.getTime()
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "WARRANTY_NOT_ELIGIBLE",
        "The source repair order is outside its active warranty period or was not confirmed.",
      );
    }
  }

  private copySnapshot(value: Prisma.JsonValue): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
