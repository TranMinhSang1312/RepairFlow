/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { MembershipRole, RepairOrderStatus } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import type { CreateDiagnosisDto } from "./diagnosis.dto.js";
import { toDiagnosisView, type DiagnosisResponse } from "./diagnosis.types.js";
import { DiagnosesRepository } from "./diagnoses.repository.js";

@Injectable()
export class DiagnosesService {
  constructor(private readonly repository: DiagnosesRepository) {}

  async create(
    tenant: TenantContext,
    repairOrderId: string,
    dto: CreateDiagnosisDto,
  ): Promise<DiagnosisResponse> {
    if (!this.isUuid(repairOrderId)) throw this.notFound();
    const normalizedOrderId = repairOrderId.toLowerCase();
    const supersedesId = dto.supersedesId?.toLowerCase() ?? null;

    return this.repository.withTransaction(async (transaction) => {
      await this.repository.lock(transaction, tenant.shopId, normalizedOrderId);
      const order = await this.repository.findOrder(transaction, tenant.shopId, normalizedOrderId);
      if (!order || !this.actorCanSee(order.assignments[0]?.technicianUserId, tenant)) {
        throw this.notFound();
      }
      this.assertPermission(tenant);
      if (order.status !== RepairOrderStatus.DIAGNOSING) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "REPAIR_ORDER_GUARD_FAILED",
          "A diagnosis can only be published while the order is being diagnosed.",
        );
      }
      if (
        supersedesId &&
        !(await this.repository.findSuperseded(
          transaction,
          tenant.shopId,
          normalizedOrderId,
          supersedesId,
        ))
      ) {
        throw this.notFound();
      }

      const diagnosis = await this.repository.create(transaction, {
        shopId: tenant.shopId,
        repairOrderId: normalizedOrderId,
        revisionNo: await this.repository.allocateRevision(transaction, normalizedOrderId),
        finding: dto.finding,
        recommendation: dto.recommendation,
        supersedesId,
        actorUserId: tenant.userId,
        requestId: tenant.requestId,
      });
      return { data: toDiagnosisView(diagnosis) };
    });
  }

  private actorCanSee(assignedTechnicianUserId: string | undefined, tenant: TenantContext) {
    return tenant.role !== MembershipRole.TECHNICIAN || assignedTechnicianUserId === tenant.userId;
  }

  private assertPermission(tenant: TenantContext): void {
    if (tenant.role === MembershipRole.RECEPTIONIST) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "PERMISSION_DENIED",
        "You do not have permission to publish a diagnosis.",
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
