"use client";

import { useCallback, useEffect, useState } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import type { AuditLogApi } from "@/lib/api/intake-api";
import type { AuditLog, CurrentUser } from "@/lib/api/types";
import { formatShopDateTime } from "@/lib/datetime";

export function AuditLogSettings({
  api,
  user,
  shopId,
  timezone,
}: {
  api: AuditLogApi;
  user: CurrentUser;
  shopId: string;
  timezone: string;
}) {
  const membership = user.memberships.find(
    (item) => item.shopId === shopId && item.status === "ACTIVE",
  );
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const page = await api.listAuditLogs(shopId, filter ? { entityType: filter } : {});
      setLogs(page.data);
      setState("ready");
    } catch (reason) {
      setError(safeErrorMessage(reason));
      setState("error");
    }
  }, [api, filter, shopId]);
  useEffect(() => void load(), [load]);

  if (!membership || membership.role !== "OWNER")
    return (
      <main className="settings-shell">
        <section className="settings-card">
          <h1>Lịch sử thay đổi</h1>
          <p role="alert">Chỉ chủ cửa hàng được truy cập khu vực này.</p>
        </section>
      </main>
    );
  return (
    <main className="settings-shell">
      <header className="settings-heading">
        <div>
          <p className="eyebrow">Bảo mật và truy vết</p>
          <h1>Lịch sử thay đổi</h1>
          <p>Chỉ metadata an toàn được hiển thị; token, secret và payload provider bị loại bỏ.</p>
        </div>
      </header>
      <section className="settings-card">
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input
            aria-label="Lọc loại đối tượng"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="CUSTOMER, QUOTE…"
          />
          <button className="button button-secondary">Lọc</button>
        </form>
      </section>
      {state === "loading" && (
        <section className="settings-card" aria-busy="true">
          <p>Đang tải lịch sử…</p>
        </section>
      )}
      {state === "error" && (
        <section className="settings-card">
          <p role="alert">{error}</p>
          <button className="button button-secondary" onClick={() => void load()}>
            Thử lại
          </button>
        </section>
      )}
      {state === "ready" && (
        <section className="settings-card audit-list">
          {logs.length === 0 ? (
            <p>Chưa có thay đổi phù hợp.</p>
          ) : (
            logs.map((log) => (
              <article className="settings-list-row" key={log.id}>
                <div>
                  <strong>{log.action}</strong>
                  <p>
                    {log.entityType} · {log.entityId}
                  </p>
                </div>
                <time dateTime={log.createdAt}>{formatShopDateTime(log.createdAt, timezone)}</time>
              </article>
            ))
          )}
        </section>
      )}
    </main>
  );
}
