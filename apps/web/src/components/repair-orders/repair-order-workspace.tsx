"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import { BrowserIntakeApi, type RepairOrderReadApi } from "@/lib/api/intake-api";
import type {
  AuthData,
  CurrentUser,
  Membership,
  RepairOrderDetail,
  RepairOrderStatus,
} from "@/lib/api/types";
import { useAuth } from "@/lib/auth/auth-provider";

type WorkspaceTab = "overview" | "timeline";
type LoadState = "loading" | "success" | "error";

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

interface RepairOrderWorkspaceScreenProps {
  repairOrderId: string;
  api?: RepairOrderReadApi;
  search?: string;
  replaceUrl?: (url: string) => void;
  sessionUser?: CurrentUser | undefined;
}

function activeMemberships(auth: AuthData): Membership[] {
  return auth.user.memberships.filter((membership) => membership.status === "ACTIVE");
}

function dateTime(value: string | null): string {
  if (!value) return "Chưa có";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function payloadSummary(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

export function RepairOrderWorkspaceScreen({
  repairOrderId,
  api: suppliedApi,
  search = "",
  replaceUrl = () => undefined,
  sessionUser,
}: RepairOrderWorkspaceScreenProps) {
  const [api] = useState<RepairOrderReadApi>(() => suppliedApi ?? new BrowserIntakeApi());
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [shopId, setShopId] = useState("");
  const [order, setOrder] = useState<RepairOrderDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const initialShopId = useState(() => params.get("shopId"))[0];
  const sharedSessionInitialized = useRef(false);

  useEffect(() => {
    if (sessionUser) {
      if (sharedSessionInitialized.current) return;
      sharedSessionInitialized.current = true;
      const session = { accessToken: "", expiresInSeconds: 0, user: sessionUser };
      const memberships = activeMemberships(session);
      const initial = memberships.find((item) => item.shopId === initialShopId) ?? memberships[0];
      setAuth(session);
      setShopId(initial?.shopId ?? "");
      if (!initial) {
        setError("Tài khoản chưa có quyền truy cập cửa hàng đang hoạt động.");
        setLoadState("error");
      }
      return;
    }
    let active = true;
    void api
      .restoreSession()
      .then((session) => {
        if (!active) return;
        const memberships = activeMemberships(session);
        const initial = memberships.find((item) => item.shopId === initialShopId) ?? memberships[0];
        setAuth(session);
        setShopId(initial?.shopId ?? "");
        if (!initial) {
          setError("Tài khoản chưa có quyền truy cập cửa hàng đang hoạt động.");
          setLoadState("error");
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(safeErrorMessage(reason));
        setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [api, initialShopId, sessionUser]);

  useEffect(() => {
    if (!auth) return;
    const requestedShop = params.get("shopId");
    if (
      requestedShop &&
      requestedShop !== shopId &&
      activeMemberships(auth).some((item) => item.shopId === requestedShop)
    ) {
      setShopId(requestedShop);
    }
  }, [auth, params, shopId]);

  useEffect(() => {
    if (!shopId) return;
    let active = true;
    setOrder(null);
    setLoadState("loading");
    setError("");
    void api
      .getRepairOrder(shopId, repairOrderId)
      .then((result) => {
        if (!active) return;
        setOrder(result);
        setLoadState("success");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(safeErrorMessage(reason));
        setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [api, repairOrderId, shopId]);

  const memberships = auth ? activeMemberships(auth) : [];
  const membership = memberships.find((item) => item.shopId === shopId);

  function changeShop(nextShopId: string) {
    setShopId(nextShopId);
    const next = new URLSearchParams(params);
    next.set("shopId", nextShopId);
    replaceUrl(`/orders/${encodeURIComponent(repairOrderId)}?${next.toString()}`);
  }

  if (loadState === "loading") {
    return (
      <main className="workspace-shell centered-state" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <h1>Đang mở workspace</h1>
      </main>
    );
  }

  if (loadState === "error" || !order || !membership || !auth) {
    return (
      <main className="workspace-shell centered-state">
        <span className="state-icon" aria-hidden="true">
          !
        </span>
        <h1>Không thể mở phiếu</h1>
        <p role="alert">{error || "Không tìm thấy phiếu trong cửa hàng đang chọn."}</p>
        <Link
          className="button button-secondary"
          href={`/orders${shopId ? `?shopId=${encodeURIComponent(shopId)}` : ""}`}
        >
          Quay lại bảng
        </Link>
      </main>
    );
  }

  const branch = membership.branches.find((item) => item.id === order.branchId);

  return (
    <main className="workspace-shell">
      <nav className="workspace-breadcrumb" aria-label="Breadcrumb">
        <Link href={`/orders?shopId=${encodeURIComponent(shopId)}`}>Phiếu sửa chữa</Link>
        <span>/</span>
        <strong>{order.code}</strong>
        <label className="shop-selector workspace-shop-selector">
          <span>Cửa hàng</span>
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
      </nav>

      <section className="workspace-heading">
        <div>
          <p className="eyebrow">
            {membership.shopName} · {branch?.name ?? "Chi nhánh không còn hoạt động"}
          </p>
          <h1>{order.code}</h1>
          <p>
            {order.customer.name} · {order.device.brand} {order.device.model}
          </p>
        </div>
        <div className="workspace-heading-meta">
          <span className={`priority priority-${order.priority.toLowerCase()}`}>
            {order.priority}
          </span>
          <span className="status-badge">{STATUS_LABELS[order.status]}</span>
        </div>
      </section>

      <div className="workspace-tabs" role="tablist" aria-label="Nội dung phiếu">
        <button
          aria-controls="overview-panel"
          aria-selected={tab === "overview"}
          onClick={() => setTab("overview")}
          role="tab"
          type="button"
        >
          Tổng quan
        </button>
        <button
          aria-controls="timeline-panel"
          aria-selected={tab === "timeline"}
          onClick={() => setTab("timeline")}
          role="tab"
          type="button"
        >
          Dòng thời gian <span>{order.timeline.length}</span>
        </button>
      </div>

      {tab === "overview" && (
        <section className="workspace-grid" id="overview-panel" role="tabpanel">
          <article className="workspace-card overview-main">
            <header>
              <p className="eyebrow">Thông tin tiếp nhận</p>
              <h2>Vấn đề và tình trạng thiết bị</h2>
            </header>
            <dl className="workspace-facts">
              <div>
                <dt>Khách báo lỗi</dt>
                <dd>{order.reportedProblem}</dd>
              </div>
              <div>
                <dt>Tình trạng khi nhận</dt>
                <dd>{order.intakeCondition}</dd>
              </div>
              <div>
                <dt>Nhận lúc</dt>
                <dd>{dateTime(order.receivedAt)}</dd>
              </div>
              <div>
                <dt>Hẹn trả</dt>
                <dd>{dateTime(order.promisedAt)}</dd>
              </div>
              <div>
                <dt>Kỹ thuật viên</dt>
                <dd>
                  {order.assignedTechnicianUserId
                    ? `Mã ${order.assignedTechnicianUserId.slice(0, 8)}`
                    : "Chưa phân công"}
                </dd>
              </div>
              <div>
                <dt>Quyền đang dùng</dt>
                <dd>{membership.role}</dd>
              </div>
            </dl>
          </article>

          <aside className="workspace-side">
            <article className="workspace-card">
              <header>
                <p className="eyebrow">Khách hàng</p>
                <h2>{order.customer.name}</h2>
              </header>
              <p>{order.customer.phone}</p>
              <p>{order.customer.email ?? "Không có email"}</p>
            </article>
            <article className="workspace-card">
              <header>
                <p className="eyebrow">Thiết bị</p>
                <h2>
                  {order.device.brand} {order.device.model}
                </h2>
              </header>
              <dl className="compact-facts">
                <div>
                  <dt>Loại</dt>
                  <dd>{order.device.type}</dd>
                </div>
                <div>
                  <dt>Màu</dt>
                  <dd>{order.device.color ?? "—"}</dd>
                </div>
                <div>
                  <dt>Serial</dt>
                  <dd>{order.device.serialMasked ?? "—"}</dd>
                </div>
                <div>
                  <dt>IMEI</dt>
                  <dd>{order.device.imeiMasked ?? "—"}</dd>
                </div>
              </dl>
            </article>
          </aside>

          <article className="workspace-card full-card">
            <header>
              <p className="eyebrow">Phụ kiện đi kèm</p>
              <h2>{order.accessories.length} mục</h2>
            </header>
            {order.accessories.length ? (
              <ul className="evidence-list">
                {order.accessories.map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    <span>{item.conditionNote ?? "Không có ghi chú tình trạng"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-copy">Không ghi nhận phụ kiện đi kèm.</p>
            )}
          </article>

          <article className="workspace-card full-card">
            <header>
              <p className="eyebrow">Bằng chứng tiếp nhận</p>
              <h2>{order.media.length} tệp</h2>
              <p>API hiện cung cấp metadata tệp; ảnh gốc vẫn được bảo vệ trong kho riêng.</p>
            </header>
            {order.media.length ? (
              <ul className="media-grid">
                {order.media.map((item) => (
                  <li key={item.id}>
                    <span className="media-icon" aria-hidden="true">
                      ▧
                    </span>
                    <strong>{item.originalName}</strong>
                    <small>
                      {item.mimeType} · {fileSize(item.byteSize)}
                    </small>
                    <small>
                      {item.uploadedAt
                        ? `Tải lên ${dateTime(item.uploadedAt)}`
                        : "Chưa xác nhận tải lên"}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-copy">Phiếu không có metadata ảnh tiếp nhận.</p>
            )}
          </article>
        </section>
      )}

      {tab === "timeline" && (
        <section className="workspace-card timeline-card" id="timeline-panel" role="tabpanel">
          <header>
            <p className="eyebrow">Lịch sử phiếu</p>
            <h2>Dòng thời gian chỉ đọc</h2>
            <p>Nhãn “Có thể công khai” chỉ phản ánh payload công khai do API trả về.</p>
          </header>
          {order.timeline.length ? (
            <ol className="timeline-list">
              {order.timeline.map((event) => {
                const summary = payloadSummary(event.publicPayload);
                return (
                  <li key={event.id}>
                    <span className="timeline-dot" aria-hidden="true" />
                    <div>
                      <div className="timeline-event-title">
                        <strong>{event.eventType}</strong>
                        <span
                          className={
                            event.publicPayload === null
                              ? "visibility-internal"
                              : "visibility-public"
                          }
                        >
                          {event.publicPayload === null ? "Nội bộ" : "Có thể công khai"}
                        </span>
                      </div>
                      <p>
                        {event.fromStatus && event.toStatus
                          ? `${STATUS_LABELS[event.fromStatus]} → ${STATUS_LABELS[event.toStatus]}`
                          : event.toStatus
                            ? STATUS_LABELS[event.toStatus]
                            : "Sự kiện hệ thống"}
                      </p>
                      {summary && <pre>{summary}</pre>}
                      <small>
                        {dateTime(event.createdAt)} · {event.actorType}
                      </small>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="empty-copy">Chưa có sự kiện trong dòng thời gian.</p>
          )}
        </section>
      )}
    </main>
  );
}

export function RepairOrderWorkspace({ repairOrderId }: { repairOrderId: string }) {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  return (
    <RepairOrderWorkspaceScreen
      repairOrderId={repairOrderId}
      search={params.toString()}
      replaceUrl={(url) => router.replace(url, { scroll: false })}
      api={auth.api}
      sessionUser={auth.user ?? undefined}
    />
  );
}
