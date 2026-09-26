export const WORKSPACE_TABS = [
  "overview",
  "diagnosis",
  "quote",
  "work",
  "qc",
  "handover",
  "timeline",
] as const;

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export function parseWorkspaceTab(search: string | URLSearchParams): WorkspaceTab {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const value = params.get("tab");
  return WORKSPACE_TABS.includes(value as WorkspaceTab) ? (value as WorkspaceTab) : "overview";
}

export function workspaceTabUrl(
  repairOrderId: string,
  search: string | URLSearchParams,
  tab: WorkspaceTab,
): string {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  params.set("tab", tab);
  return `/orders/${encodeURIComponent(repairOrderId)}?${params.toString()}`;
}
