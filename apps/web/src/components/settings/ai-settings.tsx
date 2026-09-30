"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { RepairFlowApiError, safeErrorMessage } from "@/lib/api/errors";
import type { AiSettingsApi } from "@/lib/api/intake-api";
import type {
  AiAnalyticsRow,
  AiCapability,
  AiCapabilitySetting,
  CurrentUser,
} from "@/lib/api/types";

const CAPABILITIES: AiCapability[] = [
  "CUSTOMER_SUMMARY",
  "DEVICE_OCR",
  "INTAKE_DRAFT",
  "CHECKLIST_SUGGESTION",
];
const LABELS: Record<AiCapability, string> = {
  CUSTOMER_SUMMARY: "Tóm tắt kỹ thuật cho khách",
  DEVICE_OCR: "Đọc thông tin thiết bị từ ảnh",
  INTAKE_DRAFT: "Tạo nháp tiếp nhận",
  CHECKLIST_SUGGESTION: "Gợi ý checklist",
};

interface DraftSetting {
  enabled: boolean;
  monthlyBudgetMicrousd: string;
  maxRunCostMicrousd: string;
  expectedLockVersion: number;
}

export function AiSettings({
  api,
  user,
  search,
  replaceUrl,
}: {
  api: AiSettingsApi;
  user: CurrentUser;
  search: string;
  replaceUrl(url: string): void;
}) {
  const ownerMemberships = user.memberships.filter(
    (membership) => membership.status === "ACTIVE" && membership.role === "OWNER",
  );
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const requestedShopId = params.get("shopId");
  const [shopId, setShopId] = useState(
    ownerMemberships.find((item) => item.shopId === requestedShopId)?.shopId ??
      ownerMemberships[0]?.shopId ??
      "",
  );
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [settings, setSettings] = useState<AiCapabilitySetting[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<AiCapability, DraftSetting>>>({});
  const [settingsState, setSettingsState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState<AiCapability | "">("");
  const [settingsError, setSettingsError] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");

  const initialFrom = params.get("from") ?? "";
  const initialTo = params.get("to") ?? "";
  const initialCapability = isCapability(params.get("capability")) ? params.get("capability")! : "";
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [capability, setCapability] = useState<AiCapability | "">(
    initialCapability as AiCapability | "",
  );
  const [appliedFilters, setAppliedFilters] = useState({
    from: initialFrom,
    to: initialTo,
    capability: initialCapability as AiCapability | "",
  });
  const [analytics, setAnalytics] = useState<AiAnalyticsRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [analyticsState, setAnalyticsState] = useState<"loading" | "ready" | "error">("loading");
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsStale, setAnalyticsStale] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!shopId) return null;
    setSettingsState("loading");
    setSettingsError("");
    try {
      const next = await api.getAiSettings(shopId);
      setGlobalEnabled(next.globalEnabled);
      setSettings(next.capabilities);
      setDrafts(
        Object.fromEntries(
          next.capabilities.map((item) => [item.capability, toDraft(item)]),
        ) as Record<AiCapability, DraftSetting>,
      );
      setSettingsState("ready");
      return next;
    } catch (reason) {
      setSettingsError(safeErrorMessage(reason));
      setSettingsState("error");
      return null;
    }
  }, [api, shopId]);

  const loadAnalytics = useCallback(async () => {
    if (!shopId) return;
    setAnalyticsState("loading");
    setAnalyticsError("");
    try {
      const page = await api.getAiAnalytics(shopId, compactFilters(appliedFilters));
      setAnalytics(page.data);
      setNextCursor(page.meta.nextCursor);
      setAnalyticsStale(false);
      setAnalyticsState("ready");
    } catch (reason) {
      setAnalyticsError(safeErrorMessage(reason));
      setAnalytics((current) => {
        setAnalyticsStale(current.length > 0);
        return current;
      });
      setAnalyticsState("error");
    }
  }, [api, appliedFilters, shopId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);
  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  if (ownerMemberships.length === 0) {
    return (
      <main className="settings-shell">
        <section className="settings-card">
          <h1>Trợ lý AI</h1>
          <p role="alert">Chỉ chủ cửa hàng được truy cập khu vực này.</p>
        </section>
      </main>
    );
  }

  function changeShop(nextShopId: string) {
    setShopId(nextShopId);
    setSettings([]);
    setAnalytics([]);
    updateLocation(nextShopId, appliedFilters);
  }

  function patchDraft(target: AiCapability, patch: Partial<DraftSetting>) {
    setDrafts((current) => ({
      ...current,
      [target]: { ...current[target]!, ...patch },
    }));
  }

  async function save(target: AiCapability) {
    const draft = drafts[target];
    if (!draft || saving) return;
    setSaving(target);
    setSettingsError("");
    setSettingsMessage("");
    try {
      const next = await api.updateAiSetting(shopId, target, draft);
      setSettings(next.capabilities);
      setDrafts(
        Object.fromEntries(
          next.capabilities.map((item) => [item.capability, toDraft(item)]),
        ) as Record<AiCapability, DraftSetting>,
      );
      setSettingsMessage(`Đã cập nhật ${LABELS[target]}.`);
    } catch (reason) {
      if (reason instanceof RepairFlowApiError && reason.code === "AI_SETTING_VERSION_CONFLICT") {
        const proposed = { ...draft };
        const latest = await api.getAiSettings(shopId).catch(() => null);
        const current = latest?.capabilities.find((item) => item.capability === target);
        if (latest) {
          setGlobalEnabled(latest.globalEnabled);
          setSettings(latest.capabilities);
        }
        setDrafts((all) => ({
          ...all,
          [target]: {
            ...proposed,
            expectedLockVersion: current?.lockVersion ?? proposed.expectedLockVersion,
          },
        }));
        setSettingsError(
          "Cấu hình vừa thay đổi. Giá trị bạn đề xuất vẫn được giữ; hãy kiểm tra và lưu lại.",
        );
      } else {
        setSettingsError(safeErrorMessage(reason));
      }
    } finally {
      setSaving("");
    }
  }

  function applyFilters() {
    const next = { from, to, capability };
    setAppliedFilters(next);
    updateLocation(shopId, next);
  }

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await api.getAiAnalytics(shopId, compactFilters(appliedFilters), nextCursor);
      setAnalytics((current) => [...current, ...page.data]);
      setNextCursor(page.meta.nextCursor);
      setAnalyticsStale(false);
    } catch (reason) {
      setAnalyticsError(safeErrorMessage(reason));
      setAnalyticsStale(true);
    }
  }

  function updateLocation(
    nextShopId: string,
    filters: { from: string; to: string; capability: AiCapability | "" },
  ) {
    const next = new URLSearchParams({ shopId: nextShopId });
    if (filters.from) next.set("from", filters.from);
    if (filters.to) next.set("to", filters.to);
    if (filters.capability) next.set("capability", filters.capability);
    replaceUrl(`/settings/ai?${next.toString()}`);
  }

  return (
    <main className="settings-shell ai-settings-shell">
      <header className="settings-hero">
        <div>
          <p className="eyebrow">Owner operations</p>
          <h1>Trợ lý AI</h1>
          <p>Mọi kết quả là bản nháp và cần nhân viên kiểm tra trước khi dùng.</p>
        </div>
        <label className="field">
          <span>Cửa hàng</span>
          <select value={shopId} onChange={(event) => changeShop(event.target.value)}>
            {ownerMemberships.map((membership) => (
              <option key={membership.shopId} value={membership.shopId}>
                {membership.shopName}
              </option>
            ))}
          </select>
        </label>
      </header>

      {!globalEnabled && (
        <p className="notice notice-info">
          AI đang bị tắt toàn cục; cấu hình cửa hàng chưa có hiệu lực.
        </p>
      )}
      {settingsError && (
        <p className="notice notice-error" role="alert">
          {settingsError}
        </p>
      )}
      {settingsMessage && (
        <p className="notice notice-success" role="status">
          {settingsMessage}
        </p>
      )}
      {settingsState === "loading" && <p aria-busy="true">Đang tải cấu hình AI…</p>}
      {settingsState === "error" && (
        <button className="button button-secondary" onClick={() => void loadSettings()}>
          Thử lại
        </button>
      )}
      <section className="ai-setting-grid" aria-label="Cấu hình capability AI">
        {CAPABILITIES.map((name) => {
          const saved = settings.find((item) => item.capability === name);
          const draft = drafts[name];
          if (!saved || !draft) return null;
          return (
            <article className="settings-card ai-setting-card" key={name}>
              <header>
                <div>
                  <h2>{LABELS[name]}</h2>
                  <small>Version {saved.lockVersion}</small>
                </div>
                <label className="consent-box">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => patchDraft(name, { enabled: event.target.checked })}
                  />
                  <span>Bật cho cửa hàng</span>
                </label>
              </header>
              <p className="muted-copy">
                Không nhập API key trên web. Dữ liệu gửi AI tuân theo allowlist của từng capability.
              </p>
              <div className="form-grid">
                <label className="field">
                  <span>Ngân sách tháng (micro-USD)</span>
                  <input
                    value={draft.monthlyBudgetMicrousd}
                    inputMode="numeric"
                    onChange={(event) =>
                      patchDraft(name, { monthlyBudgetMicrousd: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Giới hạn mỗi lượt (micro-USD)</span>
                  <input
                    value={draft.maxRunCostMicrousd}
                    inputMode="numeric"
                    onChange={(event) =>
                      patchDraft(name, { maxRunCostMicrousd: event.target.value })
                    }
                  />
                </label>
              </div>
              <p>
                Đã dùng: {saved.currentPeriodSpentMicrousd} · Đang giữ:{" "}
                {saved.currentPeriodReservedMicrousd} micro-USD
              </p>
              <button
                className="button button-primary"
                disabled={saving === name}
                onClick={() => void save(name)}
              >
                {saving === name ? "Đang lưu…" : "Lưu cấu hình"}
              </button>
            </article>
          );
        })}
      </section>

      <section className="settings-card ai-analytics" aria-label="Phân tích sử dụng AI">
        <header>
          <div>
            <p className="eyebrow">Privacy-safe analytics</p>
            <h2>Hiệu quả sử dụng</h2>
          </div>
        </header>
        <div className="ai-analytics-filters">
          <label className="field">
            <span>Từ ngày</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="field">
            <span>Đến ngày</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label className="field">
            <span>Capability</span>
            <select
              value={capability}
              onChange={(event) => setCapability(event.target.value as AiCapability | "")}
            >
              <option value="">Tất cả</option>
              {CAPABILITIES.map((name) => (
                <option key={name} value={name}>
                  {LABELS[name]}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-secondary" onClick={applyFilters}>
            Áp dụng bộ lọc
          </button>
        </div>
        {analyticsState === "loading" && <p aria-busy="true">Đang tải số liệu…</p>}
        {analyticsError && (
          <p className="notice notice-error" role="alert">
            {analyticsError}
          </p>
        )}
        {analyticsStale && (
          <p className="notice notice-info">Đang hiển thị số liệu cũ do lần tải mới thất bại.</p>
        )}
        {analyticsState === "ready" && analytics.length === 0 && (
          <p className="empty-copy">Chưa có lượt AI trong khoảng đã chọn.</p>
        )}
        {analytics.length > 0 && (
          <div className="ai-analytics-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Capability</th>
                  <th>Yêu cầu</th>
                  <th>Thành công / lỗi</th>
                  <th>Review</th>
                  <th>P50 / P95</th>
                  <th>Chi phí</th>
                </tr>
              </thead>
              <tbody>
                {analytics.map((row) => (
                  <tr key={`${row.date}:${row.capability}`}>
                    <td>{row.date}</td>
                    <td>{LABELS[row.capability]}</td>
                    <td>{row.requestedCount}</td>
                    <td>
                      {row.succeededCount} / {row.failedCount}
                    </td>
                    <td>
                      {row.reviewedCount} ({row.acceptedUnchangedCount}/{row.acceptedEditedCount}/
                      {row.rejectedCount})
                    </td>
                    <td>
                      {row.p50LatencyMs ?? "—"} / {row.p95LatencyMs ?? "—"} ms
                    </td>
                    <td>{row.estimatedCostMicrousd} µUSD</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor && (
          <button className="button button-secondary" onClick={() => void loadMore()}>
            Tải thêm
          </button>
        )}
      </section>
    </main>
  );
}

function toDraft(item: AiCapabilitySetting): DraftSetting {
  return {
    enabled: item.enabled,
    monthlyBudgetMicrousd: item.monthlyBudgetMicrousd,
    maxRunCostMicrousd: item.maxRunCostMicrousd,
    expectedLockVersion: item.lockVersion,
  };
}

function compactFilters(filters: { from: string; to: string; capability: AiCapability | "" }) {
  return {
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(filters.capability ? { capability: filters.capability } : {}),
  };
}

function isCapability(value: string | null): value is AiCapability {
  return CAPABILITIES.includes(value as AiCapability);
}
