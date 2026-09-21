/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";

import { ApiException } from "../../../common/api-exception.js";
import type { TenantContext } from "../../../common/tenant/tenant-context.js";
import type { AssignTechnicianDto } from "./assignment.dto.js";
import {
  toAssignmentView,
  type AssignmentResponse,
  type TechnicianListResponse,
} from "./assignment.types.js";
import { AssignmentsRepository } from "./assignments.repository.js";

@Injectable()
export class AssignmentsService {
  constructor(private readonly repository: AssignmentsRepository) {}

  async listTechnicians(tenant: TenantContext): Promise<TechnicianListResponse> {
    return { data: await this.repository.listAssignableTechnicians(tenant.shopId) };
  }

  async assign(
    tenant: TenantContext,
    repairOrderId: string,
    dto: AssignTechnicianDto,
  ): Promise<AssignmentResponse> {
    if (!this.isUuid(repairOrderId)) throw this.notFound();
    const assignment = await this.repository.assign(
      tenant,
      repairOrderId.toLowerCase(),
      dto.technicianUserId,
    );
    if (!assignment) throw this.notFound();
    return { data: toAssignmentView(assignment) };
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
