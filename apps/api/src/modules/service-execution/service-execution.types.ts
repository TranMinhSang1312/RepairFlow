import type {
  PartRequirement,
  PartRequirementStatus,
  PartUsed,
  Prisma,
  QuoteDecision,
  QuoteItemKind,
  QuoteQuantityUnit,
  WorkLog,
  WorkLogType,
} from "@prisma/client";

export interface ApprovedScopeItem {
  quoteItemId: string;
  scopeKey: string;
  kind: QuoteItemKind;
  description: string;
  displayNote: string | null;
  quantity: number;
  quantityUnit: QuoteQuantityUnit;
  unitPrice: number;
  lineTotal: number;
  isOptional: boolean;
  approvalGroup: string | null;
}

export interface ApprovedScopeSummary {
  quoteVersionId: string;
  decision: Extract<QuoteDecision, "ACCEPTED" | "PARTIALLY_ACCEPTED">;
  approvedTotal: number;
  decidedAt: string;
  items: ApprovedScopeItem[];
}

export interface WorkLogView {
  id: string;
  repairOrderId: string;
  quoteItemId: string | null;
  scopeKey: string | null;
  type: WorkLogType;
  effectiveType: Exclude<WorkLogType, "CORRECTION">;
  content: string;
  supersedesId: string | null;
  isEffective: boolean;
  createdByUserId: string;
  createdAt: string;
}

export interface PartRequirementView {
  id: string;
  repairOrderId: string;
  quoteItemId: string;
  scopeKey: string;
  nameSnapshot: string;
  sku: string | null;
  quantity: number;
  quantityUnit: QuoteQuantityUnit;
  status: PartRequirementStatus;
  lockVersion: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PartUsedView {
  id: string;
  repairOrderId: string;
  quoteItemId: string;
  scopeKey: string;
  supersedesId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  unitCost: number | null;
  unitSalePrice: number | null;
  isEffective: boolean;
  createdByUserId: string;
  createdAt: string;
}

export interface WorkLogResponse {
  data: WorkLogView;
}

export interface PartRequirementResponse {
  data: PartRequirementView;
}

export interface PartUsedResponse {
  data: PartUsedView;
}

export type WorkLogRecord = WorkLog & { quoteItem: { scopeKey: string } | null };

export function toWorkLogViews(logs: WorkLogRecord[]): WorkLogView[] {
  const byId = new Map(logs.map((log) => [log.id, log]));
  const superseded = new Set(logs.flatMap((log) => (log.supersedesId ? [log.supersedesId] : [])));

  return logs.map((log) => {
    const root = workLogRoot(log, byId);
    return {
      id: log.id,
      repairOrderId: log.repairOrderId,
      quoteItemId: root.quoteItemId,
      scopeKey: root.quoteItem?.scopeKey ?? null,
      type: log.type,
      effectiveType: root.type as Exclude<WorkLogType, "CORRECTION">,
      content: log.content,
      supersedesId: log.supersedesId,
      isEffective: !superseded.has(log.id),
      createdByUserId: log.createdByUserId,
      createdAt: log.createdAt.toISOString(),
    };
  });
}

function workLogRoot(log: WorkLogRecord, byId: ReadonlyMap<string, WorkLogRecord>): WorkLogRecord {
  let current = log;
  const seen = new Set<string>();
  while (current.type === "CORRECTION" && current.supersedesId) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const parent = byId.get(current.supersedesId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

export function toPartRequirementView(requirement: PartRequirement): PartRequirementView {
  return {
    id: requirement.id,
    repairOrderId: requirement.repairOrderId,
    quoteItemId: requirement.quoteItemId,
    scopeKey: requirement.scopeKey,
    nameSnapshot: requirement.nameSnapshot,
    sku: requirement.sku,
    quantity: Number(requirement.quantity.toString()),
    quantityUnit: requirement.quantityUnit,
    status: requirement.status,
    lockVersion: requirement.lockVersion,
    createdByUserId: requirement.createdByUserId,
    updatedByUserId: requirement.updatedByUserId,
    createdAt: requirement.createdAt.toISOString(),
    updatedAt: requirement.updatedAt.toISOString(),
  };
}

type BoundPartUsed = PartUsed & { quoteItemId: string; scopeKey: string };

export function toPartUsedViews(parts: PartUsed[]): PartUsedView[] {
  const superseded = new Set(
    parts.flatMap((part) => (part.supersedesId ? [part.supersedesId] : [])),
  );
  return parts.filter(isBoundPartUsed).map((part) => ({
    id: part.id,
    repairOrderId: part.repairOrderId,
    quoteItemId: part.quoteItemId,
    scopeKey: part.scopeKey,
    supersedesId: part.supersedesId,
    name: part.name,
    sku: part.sku,
    quantity: Number(part.quantity.toString()),
    unitCost: part.unitCost === null ? null : Number(part.unitCost),
    unitSalePrice: part.unitSalePrice === null ? null : Number(part.unitSalePrice),
    isEffective: !superseded.has(part.id),
    createdByUserId: part.createdByUserId,
    createdAt: part.createdAt.toISOString(),
  }));
}

function isBoundPartUsed(part: PartUsed): part is BoundPartUsed {
  return part.quoteItemId !== null && part.scopeKey !== null;
}

export interface ApprovalRecord {
  id: string;
  versionNo: number;
  approval: {
    decision: QuoteDecision;
    approvedItemSnapshot: Prisma.JsonValue;
    approvedTotal: bigint;
    decidedAt: Date;
  } | null;
}

export function parseApprovedScope(
  binding: ApprovalRecord | undefined,
): ApprovedScopeSummary | null {
  if (!binding?.approval || !Array.isArray(binding.approval.approvedItemSnapshot)) return null;
  if (
    binding.approval.decision !== "ACCEPTED" &&
    binding.approval.decision !== "PARTIALLY_ACCEPTED"
  ) {
    return null;
  }

  const items: ApprovedScopeItem[] = [];
  const ids = new Set<string>();
  const scopeKeys = new Set<string>();
  for (const entry of binding.approval.approvedItemSnapshot) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const item = entry as Record<string, Prisma.JsonValue>;
    if (
      typeof item.id !== "string" ||
      typeof item.scopeKey !== "string" ||
      !["SERVICE", "PART", "FEE"].includes(String(item.kind)) ||
      typeof item.description !== "string" ||
      !(item.displayNote === null || typeof item.displayNote === "string") ||
      typeof item.quantity !== "number" ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      !["EACH", "HOUR"].includes(String(item.quantityUnit)) ||
      typeof item.unitPrice !== "number" ||
      !Number.isSafeInteger(item.unitPrice) ||
      item.unitPrice < 0 ||
      typeof item.lineTotal !== "number" ||
      !Number.isSafeInteger(item.lineTotal) ||
      item.lineTotal < 0 ||
      typeof item.isOptional !== "boolean" ||
      !(item.approvalGroup === null || typeof item.approvalGroup === "string") ||
      ids.has(item.id) ||
      scopeKeys.has(item.scopeKey)
    ) {
      return null;
    }
    ids.add(item.id);
    scopeKeys.add(item.scopeKey);
    items.push({
      quoteItemId: item.id,
      scopeKey: item.scopeKey,
      kind: item.kind as QuoteItemKind,
      description: item.description,
      displayNote: item.displayNote,
      quantity: item.quantity,
      quantityUnit: item.quantityUnit as QuoteQuantityUnit,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      isOptional: item.isOptional,
      approvalGroup: item.approvalGroup,
    });
  }

  const approvedTotal = Number(binding.approval.approvedTotal);
  if (!Number.isSafeInteger(approvedTotal) || approvedTotal < 0) return null;
  return {
    quoteVersionId: binding.id,
    decision: binding.approval.decision,
    approvedTotal,
    decidedAt: binding.approval.decidedAt.toISOString(),
    items,
  };
}
