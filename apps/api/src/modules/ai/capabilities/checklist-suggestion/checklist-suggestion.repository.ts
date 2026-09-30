import { Injectable } from "@nestjs/common";
import { MembershipRole, type Prisma } from "@prisma/client";

import type { TenantContext } from "../../../../common/tenant/tenant-context.js";

@Injectable()
export class ChecklistSuggestionRepository {
  async loadContext(
    transaction: Prisma.TransactionClient,
    tenant: TenantContext,
    input: { repairOrderId: string; qcTemplateId: string },
  ) {
    const order = await transaction.repairOrder.findFirst({
      where: {
        shopId: tenant.shopId,
        id: input.repairOrderId,
        ...(tenant.role === MembershipRole.TECHNICIAN
          ? {
              assignments: {
                some: { technicianUserId: tenant.userId, unassignedAt: null },
              },
            }
          : {}),
      },
      select: {
        id: true,
        reportedProblem: true,
        device: { select: { type: true } },
      },
    });
    if (!order) return null;

    const template = await transaction.qcTemplate.findFirst({
      where: { shopId: tenant.shopId, id: input.qcTemplateId, isActive: true },
      select: {
        id: true,
        items: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { id: true, label: true, isRequired: true, allowNa: true },
        },
      },
    });
    return template ? { order, template } : null;
  }
}
