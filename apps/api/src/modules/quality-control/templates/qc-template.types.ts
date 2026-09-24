import type { Prisma } from "@prisma/client";

export const qcTemplateInclude = {
  items: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.QcTemplateInclude;

export type QcTemplateRecord = Prisma.QcTemplateGetPayload<{
  include: typeof qcTemplateInclude;
}>;

export interface QcTemplateItemView {
  id: string;
  label: string;
  isRequired: boolean;
  allowNa: boolean;
  sortOrder: number;
}

export interface QcTemplateView {
  id: string;
  name: string;
  versionNo: number;
  isActive: boolean;
  items: QcTemplateItemView[];
  createdAt: string;
}

export interface QcTemplateResponse {
  data: QcTemplateView;
}

export interface QcTemplateListResponse {
  data: QcTemplateView[];
}

export function toQcTemplateView(template: QcTemplateRecord): QcTemplateView {
  return {
    id: template.id,
    name: template.name,
    versionNo: template.versionNo,
    isActive: template.isActive,
    items: template.items.map((item) => ({
      id: item.id,
      label: item.label,
      isRequired: item.isRequired,
      allowNa: item.allowNa,
      sortOrder: item.sortOrder,
    })),
    createdAt: template.createdAt.toISOString(),
  };
}
