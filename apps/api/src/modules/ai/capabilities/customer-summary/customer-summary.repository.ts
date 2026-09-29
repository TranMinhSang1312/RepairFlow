import { Injectable } from "@nestjs/common";
import { MembershipRole, type Prisma, WorkLogType } from "@prisma/client";

import type { TenantContext } from "../../../../common/tenant/tenant-context.js";

const ALLOWED_WORK_LOG_TYPES = [WorkLogType.REPAIR, WorkLogType.TEST] as const;

export interface CustomerSummarySources {
  diagnosis: { id: string; finding: string; recommendation: string } | null;
  workLogs: Array<{ id: string; content: string }>;
}

@Injectable()
export class CustomerSummaryRepository {
  async loadSources(
    transaction: Prisma.TransactionClient,
    tenant: TenantContext,
    input: { repairOrderId: string; diagnosisId?: string; workLogIds: string[] },
  ): Promise<CustomerSummarySources | null> {
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
      select: { id: true },
    });
    if (!order) return null;

    const diagnosis = input.diagnosisId
      ? await transaction.diagnosis.findFirst({
          where: {
            id: input.diagnosisId,
            shopId: tenant.shopId,
            repairOrderId: input.repairOrderId,
          },
          select: { id: true, finding: true, recommendation: true },
        })
      : null;
    if (input.diagnosisId && !diagnosis) return null;
    if (
      diagnosis &&
      (await transaction.diagnosis.findFirst({
        where: {
          shopId: tenant.shopId,
          repairOrderId: input.repairOrderId,
          supersedesId: diagnosis.id,
        },
        select: { id: true },
      }))
    ) {
      return null;
    }

    const orderWorkLogs =
      input.workLogIds.length === 0
        ? []
        : await transaction.workLog.findMany({
            where: {
              shopId: tenant.shopId,
              repairOrderId: input.repairOrderId,
            },
            select: { id: true, type: true, content: true, supersedesId: true },
          });
    const byId = new Map(orderWorkLogs.map((workLog) => [workLog.id, workLog] as const));
    const superseded = new Set(
      orderWorkLogs.flatMap((workLog) => (workLog.supersedesId ? [workLog.supersedesId] : [])),
    );
    const workLogs: Array<{ id: string; content: string }> = [];
    for (const id of input.workLogIds) {
      const selected = byId.get(id);
      if (!selected || superseded.has(selected.id)) continue;
      let current = selected;
      const seen = new Set<string>();
      let validChain = true;
      while (current.type === WorkLogType.CORRECTION && current.supersedesId) {
        if (seen.has(current.id)) {
          validChain = false;
          break;
        }
        seen.add(current.id);
        const previous = byId.get(current.supersedesId);
        if (!previous) {
          validChain = false;
          break;
        }
        current = previous;
      }
      if (
        validChain &&
        ALLOWED_WORK_LOG_TYPES.includes(current.type as (typeof ALLOWED_WORK_LOG_TYPES)[number])
      ) {
        workLogs.push({ id: selected.id, content: selected.content });
      }
    }
    workLogs.sort((left, right) => left.id.localeCompare(right.id));
    if (workLogs.length !== input.workLogIds.length) return null;
    return { diagnosis, workLogs };
  }
}
