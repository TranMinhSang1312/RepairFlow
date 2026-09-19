import type { RepairOrderFilters, RepairOrderStatus } from "@/lib/api/types";

export interface BoardFilters extends RepairOrderFilters {
  query: string;
  statuses: RepairOrderStatus[];
  branchId: string;
  technicianUserId: string;
}

export const REPAIR_ORDER_STATUSES: readonly RepairOrderStatus[] = [
  "RECEIVED",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "WAITING_PARTS",
  "REPAIRING",
  "QUALITY_CHECK",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "VOIDED",
];

const STATUS_SET = new Set<RepairOrderStatus>(REPAIR_ORDER_STATUSES);

export function parseBoardFilters(params: URLSearchParams): BoardFilters {
  const statuses = params
    .getAll("status")
    .filter((value): value is RepairOrderStatus => STATUS_SET.has(value as RepairOrderStatus));
  return {
    query: params.get("query")?.trim() ?? "",
    statuses: [...new Set(statuses)],
    branchId: params.get("branchId") ?? "",
    technicianUserId: params.get("technicianUserId") ?? "",
  };
}

export function updateBoardUrl(
  pathname: string,
  current: URLSearchParams,
  filters: BoardFilters,
  shopId: string,
): string {
  const params = new URLSearchParams(current);
  for (const key of ["query", "status", "branchId", "technicianUserId", "shopId"])
    params.delete(key);
  if (shopId) params.set("shopId", shopId);
  if (filters.query.trim()) params.set("query", filters.query.trim());
  for (const status of filters.statuses) params.append("status", status);
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.technicianUserId) params.set("technicianUserId", filters.technicianUserId);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
