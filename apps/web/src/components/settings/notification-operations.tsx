"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RepairFlowApiError, safeErrorMessage } from "@/lib/api/errors";
import type { NotificationOperationsApi } from "@/lib/api/intake-api";
import type {
  CurrentUser,
  NotificationChannel,
  NotificationOperation,
  NotificationOperationFilters,
} from "@/lib/api/types";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("vi-VN") : "—";
}

function statusLabel(status: NotificationOperation["status"]): string {
  if (status === "DEAD_LETTER") return "Dừng sau nhiều lần lỗi";
  if (status === "FAILED") return "Chờ thử lại";
  return "Đã xếp hàng";
}

function filtersFrom(search: string): NotificationOperationFilters {
  const params = new URLSearchParams(search);
  const status = params.get("status");
  const channel = params.get("channel");
  return {
    ...(status === "FAILED" || status === "DEAD_LETTER" ? { status } : {}),
    ...(channel === "EMAIL" || channel === "ZALO" || channel === "SMS" ? { channel } : {}),
    ...(params.get("eventType") ? { eventType: params.get("eventType")! } : {}),
  };
}

export function NotificationOperations({
  api,
  user,
  search,
  replaceUrl,
}: {
  api: NotificationOperationsApi;
  user: CurrentUser;
  search: string;
  replaceUrl(url: string): void;
}) {
  const ownerMemberships = user.memberships.filter(
    (membership) => membership.status === "ACTIVE" && membership.role === "OWNER",
  );
  const requestedShopId = useMemo(() => new URLSearchParams(search).get("shopId"), [search]);
  const initialFilters = useMemo(() => filtersFrom(search), [search]);
  const [shopId, setShopId] = useState(
    ownerMemberships.find((membership) => membership.shopId === requestedShopId)?.shopId ??
      ownerMemberships[0]?.shopId ??
      "",
  );
  const [status, setStatus] = useState(initialFilters.status ?? "");
  const [eventType, setEventType] = useState(initialFilters.eventType ?? "");
  const [channel, setChannel] = useState(initialFilters.channel ?? "");
  const [appliedFilters, setAppliedFilters] =
    useState<NotificationOperationFilters>(initialFilters);
  const [jobs, setJobs] = useState<NotificationOperation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState<NotificationOperation | null>(null);
  const [retryingId, setRetryingId] = useState("");
  const commandKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    if (!shopId) return;
    setState("loading");
    setError("");
    try {
      const page = await api.listNotificationOperations(shopId, appliedFilters);
      setJobs(page.data);
      setNextCursor(page.meta.nextCursor);
      setState("ready");
    } catch (reason) {
      setError(safeErrorMessage(reason));
      setState("error");
    }
  }, [api, appliedFilters, shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (ownerMemberships.length === 0) {
    return (
      <main className="settings-shell">
        <section className="settings-card">
          <h1>Vận hành thông báo</h1>
          <p role="alert">Chỉ chủ cửa hàng được truy cập khu vực này.</p>
        </section>
      </main>
    );
  }

  function updateLocation(nextShopId: string, filters: NotificationOperationFilters) {
    const params = new URLSearchParams({ shopId: nextShopId });
    if (filters.status) params.set("status", filters.status);
    if (filters.eventType) params.set("eventType", filters.eventType);
    if (filters.channel) params.set("channel", filters.channel);
    replaceUrl(`/settings/notifications?${params.toString()}`);
  }

  function applyFilters() {
    const next: NotificationOperationFilters = {
      ...(status ? { status: status as "FAILED" | "DEAD_LETTER" } : {}),
      ...(eventType.trim() ? { eventType: eventType.trim().toUpperCase() } : {}),
      ...(channel ? { channel: channel as NotificationChannel } : {}),
    };
    setAppliedFilters(next);
    updateLocation(shopId, next);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await api.listNotificationOperations(shopId, appliedFilters, nextCursor);
      setJobs((current) => [...current, ...page.data]);
      setNextCursor(page.meta.nextCursor);
    } catch (reason) {
      setError(safeErrorMessage(reason));
    } finally {
      setLoadingMore(false);
    }
  }

  async function retry(job: NotificationOperation) {
    const command = `${job.id}:${job.lockVersion}`;
    let key = commandKeys.current.get(command);
    if (!key) {
      key = `notification-retry-${globalThis.crypto.randomUUID()}`;
      commandKeys.current.set(command, key);
    }
    setRetryingId(job.id);
    setError("");
    setMessage("");
    try {
      await api.retryNotificationOperation(shopId, job.id, job.lockVersion, key);
      commandKeys.current.delete(command);
      setConfirming(null);
      setMessage("Đã xếp job vào hàng đợi. Worker sẽ xử lý sau khi yêu cầu hoàn tất.");
      await load();
    } catch (reason) {
      setConfirming(null);
      if (reason instanceof RepairFlowApiError && reason.code === "CONCURRENT_UPDATE") {
        await load();
        setError("Job vừa thay đổi. Danh sách đã được tải lại để bạn kiểm tra trạng thái mới.");
      } else {
        setError(safeErrorMessage(reason));
      }
    } finally {
      setRetryingId("");
    }
  }

  return (
    <main className="settings-shell notification-operations">
      <header className="settings-heading">
        <div>
          <p className="eyebrow">VẬN HÀNH CỬA HÀNG</p>
          <h1>Thông báo lỗi</h1>
          <p>Xem metadata an toàn và yêu cầu worker thử lại các thông báo gửi thất bại.</p>
        </div>
        <label>
          Cửa hàng
          <select
            value={shopId}
            onChange={(event) => {
              setShopId(event.target.value);
              updateLocation(event.target.value, appliedFilters);
            }}
          >
            {ownerMemberships.map((membership) => (
              <option key={membership.shopId} value={membership.shopId}>
                {membership.shopName}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="settings-card notification-filter-card" aria-label="Bộ lọc thông báo">
        <label>
          Trạng thái
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tất cả lỗi</option>
            <option value="FAILED">Chờ thử lại</option>
            <option value="DEAD_LETTER">Đã dừng</option>
          </select>
        </label>
        <label>
          Loại sự kiện
          <input
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
            placeholder="QUOTE_SENT"
          />
        </label>
        <label>
          Kênh
          <select value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="">Mọi kênh</option>
            <option value="EMAIL">Email</option>
            <option value="ZALO">Zalo</option>
            <option value="SMS">SMS</option>
          </select>
        </label>
        <button className="button button-secondary" type="button" onClick={applyFilters}>
          Áp dụng
        </button>
      </section>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}{" "}
          <button className="text-button" type="button" onClick={() => void load()}>
            Tải lại
          </button>
        </p>
      )}
      {message && (
        <p className="notice notice-success" role="status">
          {message}
        </p>
      )}

      {state === "loading" ? (
        <section className="settings-card" aria-busy="true">
          Đang tải job thông báo…
        </section>
      ) : state === "ready" && jobs.length === 0 ? (
        <section className="settings-card notification-empty">
          <h2>Không có thông báo lỗi</h2>
          <p>Không tìm thấy job phù hợp với bộ lọc hiện tại.</p>
        </section>
      ) : (
        <section className="notification-job-list" aria-label="Danh sách thông báo lỗi">
          {jobs.map((job) => (
            <article className="settings-card notification-job-card" key={job.id}>
              <div className="notification-job-heading">
                <div>
                  <span className={`status-badge status-${job.status.toLowerCase()}`}>
                    {statusLabel(job.status)}
                  </span>
                  <h2>{job.eventType}</h2>
                  <p>
                    {job.aggregateType} · <code>{job.aggregateId}</code>
                  </p>
                </div>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={retryingId === job.id}
                  onClick={() => setConfirming(job)}
                >
                  {retryingId === job.id ? "Đang yêu cầu…" : "Thử lại"}
                </button>
              </div>
              <dl className="notification-metadata">
                <div>
                  <dt>Số lần xử lý</dt>
                  <dd>{job.attempts}</dd>
                </div>
                <div>
                  <dt>Mã lỗi</dt>
                  <dd>{job.lastErrorCode ?? "—"}</dd>
                </div>
                <div>
                  <dt>Tạo lúc</dt>
                  <dd>{formatDate(job.createdAt)}</dd>
                </div>
                <div>
                  <dt>Có thể chạy từ</dt>
                  <dd>{formatDate(job.availableAt)}</dd>
                </div>
              </dl>
              <details>
                <summary>Chi tiết kênh gửi ({job.deliveries.length})</summary>
                <div className="notification-delivery-list">
                  {job.deliveries.map((delivery) => (
                    <div key={delivery.id}>
                      <strong>{delivery.channel}</strong>
                      <span>{delivery.status}</span>
                      <span>{delivery.attempts} lần</span>
                      <code>{delivery.lastErrorCode ?? "Không có mã lỗi"}</code>
                    </div>
                  ))}
                </div>
              </details>
            </article>
          ))}
          {nextCursor && (
            <button
              className="button button-secondary notification-load-more"
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Đang tải…" : "Tải thêm"}
            </button>
          )}
        </section>
      )}

      {confirming && (
        <div className="notification-dialog-backdrop" role="presentation">
          <section
            aria-describedby="notification-retry-description"
            aria-labelledby="notification-retry-title"
            aria-modal="true"
            className="notification-dialog"
            role="dialog"
          >
            <h2 id="notification-retry-title">Xếp job thử lại?</h2>
            <p id="notification-retry-description">
              Worker sẽ xử lý <strong>{confirming.eventType}</strong> sau khi yêu cầu này hoàn tất.
              Các kênh đã gửi thành công sẽ được giữ nguyên.
            </p>
            <div className="notification-dialog-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={retryingId === confirming.id}
                onClick={() => setConfirming(null)}
              >
                Hủy
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={retryingId === confirming.id}
                onClick={() => void retry(confirming)}
              >
                {retryingId === confirming.id ? "Đang yêu cầu…" : "Xác nhận thử lại"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
