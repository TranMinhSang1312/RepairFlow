"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import { BrowserIntakeApi, type RepairOrderReadApi } from "@/lib/api/intake-api";
import type { AuthData, Membership, RepairOrderStatus, RepairOrderSummary } from "@/lib/api/types";
import {
  parseBoardFilters,
  REPAIR_ORDER_STATUSES,
  updateBoardUrl,
  type BoardFilters,
} from "@/lib/repair-orders/board-filters";

type LoadState = "loading" | "success" | "error";

interface BoardGroup {
  id: string;
  label: string;
  statuses: RepairOrderStatus[];
}

const BOARD_GROUPS: readonly BoardGroup[] = [
  { id: "received", label: "Mới tiếp nhận", statuses: ["RECEIVED"] },
  { id: "diagnosing", label: "Đang kiểm tra", statuses: ["DIAGNOSING"] },
  { id: "approval", label: "Chờ duyệt", statuses: ["AWAITING_APPROVAL"] },
  { id: "approved", label: "Đã duyệt / chờ linh kiện", statuses: ["APPROVED", "WAITING_PARTS"] },
  { id: "repairing", label: "Đang sửa", statuses: ["REPAIRING"] },
  { id: "qc", label: "Kiểm tra chất lượng", statuses: ["QUALITY_CHECK"] },
  { id: "ready", label: "Chờ trả máy", statuses: ["READY_FOR_PICKUP"] },
  { id: "closed", label: "Đã đóng", statuses: ["COMPLETED", "VOIDED"] },
];

const STATUS_LABELS: Readonly<Record<RepairOrderStatus, string>> = {
  RECEIVED: "Mới tiếp nhận",
  DIAGNOSING: "Đang kiểm tra",
  AWAITING_APPROVAL: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  WAITING_PARTS: "Chờ linh kiện",
  REPAIRING: "Đang sửa",
  QUALITY_CHECK: "Kiểm tra chất lượng",
  READY_FOR_PICKUP: "Chờ trả máy",
  COMPLETED: "Hoàn tất",
  VOIDED: "Đã hủy",
};

const PRIORITY_LABELS = {
  LOW: "Thấp",
  NORMAL: "Bình thường",
  HIGH: "Cao",
  URGENT: "Khẩn cấp",
} as const;

export interface RepairOrderBoardScreenProps {
  api?: RepairOrderReadApi;
  pathname?: string;
  search?: string;
  replaceUrl?: (url: string) => void;
  pollIntervalMs?: number;
}

function activeMemberships(auth: AuthData): Membership[] {
  return auth.user.memberships.filter((membership) => membership.status === "ACTIVE");
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function ageLabel(receivedAt: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(receivedAt)) / 60_000));
  if (elapsedMinutes < 60) return `${elapsedMinutes} phút`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

function sameOrders(left: RepairOrderSummary[], right: RepairOrderSummary[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function RepairOrderBoardScreen({
  api: suppliedApi,
  pathname = "/orders",
  search = "",
  replaceUrl = () => undefined,
  pollIntervalMs = 30_000,
}: RepairOrderBoardScreenProps) {
  const [api] = useState<RepairOrderReadApi>(() => suppliedApi ?? new BrowserIntakeApi());
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [authError, setAuthError] = useState("");
  const [shopId, setShopId] = useState("");
  const filters = useMemo(() => parseBoardFilters(new URLSearchParams(search)), [search]);
  const [queryDraft, setQueryDraft] = useState(filters.query);
  const [orders, setOrders] = useState<RepairOrderSummary[]>([]);
  const ordersRef = useRef<RepairOrderSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [pageError, setPageError] = useState("");
  const [staleWarning, setStaleWarning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const latestRequest = useRef(0);

  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const initialShopId = useRef(searchParams.get("shopId"));

  useEffect(() => setQueryDraft(filters.query), [filters.query]);

  useEffect(() => {
    let active = true;
    void api
      .restoreSession()
      .then((session) => {
        if (!active) return;
        const memberships = activeMemberships(session);
        const requestedShop = initialShopId.current;
        const initial = memberships.find((item) => item.shopId === requestedShop) ?? memberships[0];
        setAuth(session);
        setShopId(initial?.shopId ?? "");
        if (!initial) setAuthError("Tài khoản chưa có quyền truy cập cửa hàng đang hoạt động.");
      })
      .catch((error: unknown) => {
        if (active) setAuthError(safeErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!auth) return;
    const requestedShop = searchParams.get("shopId");
    if (
      requestedShop &&
      requestedShop !== shopId &&
      activeMemberships(auth).some((item) => item.shopId === requestedShop)
    ) {
      setShopId(requestedShop);
    }
  }, [auth, searchParams, shopId]);

  const loadFirstPage = useCallback(
    async (background: boolean) => {
      if (!shopId) return;
      const requestId = ++latestRequest.current;
      if (background) setRefreshing(true);
      else setLoadState("loading");
      try {
        const page = await api.listRepairOrders(shopId, filters);
        if (requestId !== latestRequest.current) return;
        ordersRef.current = page.data;
        setOrders((current) => (sameOrders(current, page.data) ? current : page.data));
        setNextCursor(page.meta.nextCursor);
        setLoadState("success");
        setPageError("");
        setStaleWarning(false);
      } catch (error) {
        if (requestId !== latestRequest.current) return;
        if (background && ordersRef.current.length > 0) {
          setStaleWarning(true);
        } else {
          setPageError(safeErrorMessage(error));
          setLoadState("error");
        }
      } finally {
        if (requestId === latestRequest.current) setRefreshing(false);
      }
    },
    [api, filters, shopId],
  );

  useEffect(() => {
    ordersRef.current = [];
    setOrders([]);
    setStaleWarning(false);
    void loadFirstPage(false);
  }, [loadFirstPage]);

  useEffect(() => {
    if (!shopId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadFirstPage(true);
    }, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [loadFirstPage, pollIntervalMs, shopId]);

  const memberships = auth ? activeMemberships(auth) : [];
  const membership = memberships.find((item) => item.shopId === shopId);
  const technicianIds = [...new Set(orders.map((order) => order.assignedTechnicianUserId))].filter(
    (value): value is string => Boolean(value),
  );

  function replaceFilters(next: BoardFilters, nextShopId = shopId) {
    replaceUrl(updateBoardUrl(pathname, searchParams, next, nextShopId));
  }

  function changeShop(nextShopId: string) {
    setShopId(nextShopId);
    replaceFilters({ ...filters, branchId: "", technicianUserId: "" }, nextShopId);
  }

  function toggleStatus(status: RepairOrderStatus) {
    const statuses = filters.statuses.includes(status)
      ? filters.statuses.filter((item) => item !== status)
      : [...filters.statuses, status];
    replaceFilters({ ...filters, statuses });
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.listRepairOrders(shopId, filters, nextCursor);
      setOrders((current) => {
        const byId = new Map(current.map((order) => [order.id, order]));
        for (const order of page.data) byId.set(order.id, order);
        const merged = [...byId.values()];
        ordersRef.current = merged;
        return merged;
      });
      setNextCursor(page.meta.nextCursor);
    } catch (error) {
      setPageError(safeErrorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  if (!auth && !authError) {
    return (
      <main className="board-shell centered-state" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <h1>Đang mở bảng sửa chữa</h1>
      </main>
    );
  }

  if (authError || !membership || !auth) {
    return (
      <main className="board-shell centered-state">
        <span className="state-icon" aria-hidden="true">
          !
        </span>
        <h1>Không thể mở bảng</h1>
        <p role="alert">{authError}</p>
      </main>
    );
  }

  return (
    <main className="board-shell">
      <header className="staff-header board-header">
        <Link className="brand" href="/orders">
          <span>R</span>RepairFlow
        </Link>
        <label className="shop-selector">
          <span>Cửa hàng đang xem</span>
          <select
            aria-label="Cửa hàng đang xem"
            value={shopId}
            onChange={(event) => changeShop(event.target.value)}
          >
            {memberships.map((item) => (
              <option key={item.shopId} value={item.shopId}>
                {item.shopName}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="board-title-row">
        <div>
          <p className="eyebrow">Bảng vận hành · {membership.role}</p>
          <h1>Phiếu sửa chữa</h1>
          <p>
            {membership.shopName} · {orders.length} phiếu đang hiển thị
          </p>
        </div>
        <div className="board-title-actions">
          <button
            className="button button-secondary"
            disabled={refreshing}
            onClick={() => void loadFirstPage(true)}
            type="button"
          >
            {refreshing ? "Đang làm mới…" : "Làm mới"}
          </button>
          {membership.role !== "TECHNICIAN" && (
            <Link className="button button-primary" href="/intake">
              + Tạo phiếu
            </Link>
          )}
        </div>
      </section>

      <section className="board-filters" aria-label="Bộ lọc phiếu sửa chữa">
        <form
          className="board-search"
          onSubmit={(event) => {
            event.preventDefault();
            replaceFilters({ ...filters, query: queryDraft });
          }}
        >
          <label className="field grow">
            <span>Tìm phiếu</span>
            <input
              aria-label="Tìm theo mã phiếu, khách hàng hoặc thiết bị"
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="Mã phiếu, khách hàng, thiết bị…"
              value={queryDraft}
            />
          </label>
          <button className="button button-secondary" type="submit">
            Tìm
          </button>
        </form>
        <div className="board-selectors">
          <label className="field">
            <span>Chi nhánh</span>
            <select
              aria-label="Lọc theo chi nhánh"
              value={filters.branchId}
              onChange={(event) => replaceFilters({ ...filters, branchId: event.target.value })}
            >
              <option value="">Tất cả chi nhánh</option>
              {membership.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Kỹ thuật viên</span>
            <select
              aria-label="Lọc theo kỹ thuật viên"
              value={filters.technicianUserId}
              onChange={(event) =>
                replaceFilters({ ...filters, technicianUserId: event.target.value })
              }
            >
              <option value="">Tất cả kỹ thuật viên</option>
              {membership.role === "TECHNICIAN" && <option value={auth.user.id}>Tôi</option>}
              {technicianIds
                .filter((id) => id !== auth.user.id)
                .map((id) => (
                  <option key={id} value={id}>
                    KTV {shortId(id)}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <fieldset className="status-filter">
          <legend>Trạng thái</legend>
          <div>
            {REPAIR_ORDER_STATUSES.map((status) => (
              <label key={status}>
                <input
                  checked={filters.statuses.includes(status)}
                  onChange={() => toggleStatus(status)}
                  type="checkbox"
                />
                {STATUS_LABELS[status]}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {staleWarning && (
        <div className="notice notice-info stale-warning" role="status">
          Không thể lấy dữ liệu mới. Bảng vẫn giữ lần tải thành công gần nhất.
        </div>
      )}
      {pageError && loadState !== "error" && (
        <div className="notice notice-error" role="alert">
          {pageError}
        </div>
      )}

      {loadState === "loading" && (
        <section className="board-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <h2>Đang tải phiếu…</h2>
        </section>
      )}
      {loadState === "error" && (
        <section className="board-state">
          <span className="state-icon" aria-hidden="true">
            !
          </span>
          <h2>Không thể tải bảng</h2>
          <p role="alert">{pageError}</p>
          <button
            className="button button-secondary"
            onClick={() => void loadFirstPage(false)}
            type="button"
          >
            Thử lại
          </button>
        </section>
      )}
      {loadState === "success" && orders.length === 0 && (
        <section className="board-state">
          <span className="empty-mark" aria-hidden="true">
            ○
          </span>
          <h2>Chưa có phiếu phù hợp</h2>
          <p>Thay đổi bộ lọc hoặc tạo phiếu tiếp nhận đầu tiên.</p>
        </section>
      )}
      {loadState === "success" && orders.length > 0 && (
        <section className="repair-board" aria-label="Các nhóm phiếu sửa chữa">
          {BOARD_GROUPS.map((group) => {
            const groupOrders = orders.filter((order) => group.statuses.includes(order.status));
            return (
              <article className="board-column" key={group.id}>
                <header>
                  <h2>{group.label}</h2>
                  <span>{groupOrders.length}</span>
                </header>
                <div className="board-card-list">
                  {groupOrders.map((order) => (
                    <Link
                      className="order-card"
                      href={`/orders/${encodeURIComponent(order.id)}?shopId=${encodeURIComponent(shopId)}`}
                      key={order.id}
                    >
                      <div className="order-card-top">
                        <strong>{order.code}</strong>
                        <span className={`priority priority-${order.priority.toLowerCase()}`}>
                          {PRIORITY_LABELS[order.priority]}
                        </span>
                      </div>
                      <h3>{order.customer.name}</h3>
                      <p>
                        {order.device.brand} {order.device.model}
                      </p>
                      <dl>
                        <div>
                          <dt>Trạng thái</dt>
                          <dd>{STATUS_LABELS[order.status]}</dd>
                        </div>
                        <div>
                          <dt>Đã nhận</dt>
                          <dd>{ageLabel(order.receivedAt)}</dd>
                        </div>
                      </dl>
                      <footer>
                        {order.assignedTechnicianUserId
                          ? `KTV ${shortId(order.assignedTechnicianUserId)}`
                          : "Chưa phân công"}
                        <span aria-hidden="true">→</span>
                      </footer>
                    </Link>
                  ))}
                  {groupOrders.length === 0 && <p className="column-empty">Không có phiếu</p>}
                </div>
              </article>
            );
          })}
        </section>
      )}
      {nextCursor && (
        <div className="load-more">
          <button
            className="button button-secondary"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? "Đang tải…" : "Tải thêm phiếu"}
          </button>
        </div>
      )}
    </main>
  );
}

export function RepairOrderBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <RepairOrderBoardScreen
      pathname={pathname}
      search={params.toString()}
      replaceUrl={(url) => router.replace(url, { scroll: false })}
    />
  );
}
