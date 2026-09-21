import type { Diagnosis } from "@prisma/client";

export interface DiagnosisView {
  id: string;
  repairOrderId: string;
  revisionNo: number;
  finding: string;
  recommendation: string;
  supersedesId: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface DiagnosisResponse {
  data: DiagnosisView;
}

export function toDiagnosisView(diagnosis: Diagnosis): DiagnosisView {
  return {
    id: diagnosis.id,
    repairOrderId: diagnosis.repairOrderId,
    revisionNo: diagnosis.revisionNo,
    finding: diagnosis.finding,
    recommendation: diagnosis.recommendation,
    supersedesId: diagnosis.supersedesId,
    createdByUserId: diagnosis.createdByUserId,
    createdAt: diagnosis.createdAt.toISOString(),
  };
}
