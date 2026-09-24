import type { Prisma, QcItemResult, QcRunResult, RepairOrderStatus } from "@prisma/client";

export const qcRunInclude = {
  template: { select: { name: true, versionNo: true } },
  results: {
    include: {
      templateItem: { select: { label: true, sortOrder: true } },
      evidence: { select: { mediaAssetId: true } },
    },
  },
} satisfies Prisma.QcRunInclude;

export type QcRunRecord = Prisma.QcRunGetPayload<{ include: typeof qcRunInclude }>;

export interface QcResultView {
  id: string;
  qcTemplateItemId: string;
  labelSnapshot: string;
  result: QcItemResult;
  note: string | null;
  evidenceMediaAssetIds: string[];
}

export interface QcRunView {
  id: string;
  repairOrderId: string;
  qcTemplateId: string;
  templateName: string;
  templateVersionNo: number;
  runNo: number;
  result: QcRunResult;
  notes: string | null;
  results: QcResultView[];
  checkedByUserId: string;
  createdAt: string;
}

export interface QcRunResponse {
  data: {
    run: QcRunView;
    orderStatus: RepairOrderStatus;
    orderLockVersion: number;
  };
}

export function toQcRunView(run: QcRunRecord): QcRunView {
  return {
    id: run.id,
    repairOrderId: run.repairOrderId,
    qcTemplateId: run.qcTemplateId,
    templateName: run.template.name,
    templateVersionNo: run.template.versionNo,
    runNo: run.runNo,
    result: run.result,
    notes: run.notes,
    results: [...run.results]
      .sort(
        (left, right) =>
          left.templateItem.sortOrder - right.templateItem.sortOrder ||
          left.qcTemplateItemId.localeCompare(right.qcTemplateItemId),
      )
      .map((result) => ({
        id: result.id,
        qcTemplateItemId: result.qcTemplateItemId,
        labelSnapshot: result.templateItem.label,
        result: result.result,
        note: result.note,
        evidenceMediaAssetIds: result.evidence
          .map((entry) => entry.mediaAssetId)
          .sort((left, right) => left.localeCompare(right)),
      })),
    checkedByUserId: run.checkedByUserId,
    createdAt: run.createdAt.toISOString(),
  };
}
