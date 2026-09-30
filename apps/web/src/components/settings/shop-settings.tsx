"use client";

import { useCallback, useEffect, useState } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import type { ShopSettingsApi } from "@/lib/api/intake-api";
import type { CurrentUser, ShopSettings } from "@/lib/api/types";

export function ShopSettings({
  api,
  user,
  shopId,
}: {
  api: ShopSettingsApi;
  user: CurrentUser;
  shopId: string;
}) {
  const membership = user.memberships.find(
    (item) => item.shopId === shopId && item.status === "ACTIVE",
  );
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      setSettings(await api.getShopSettings(shopId));
      setState("ready");
    } catch (reason) {
      setError(safeErrorMessage(reason));
      setState("error");
    }
  }, [api, shopId]);

  useEffect(() => void load(), [load]);

  if (!membership || membership.role !== "OWNER") {
    return (
      <main className="settings-shell">
        <section className="settings-card">
          <h1>Cài đặt cửa hàng</h1>
          <p role="alert">Chỉ chủ cửa hàng được truy cập khu vực này.</p>
        </section>
      </main>
    );
  }
  if (state === "loading")
    return (
      <main className="settings-shell">
        <section className="settings-card" aria-busy="true">
          <h1>Cài đặt cửa hàng</h1>
          <p>Đang tải…</p>
        </section>
      </main>
    );
  if (state === "error" || !settings)
    return (
      <main className="settings-shell">
        <section className="settings-card">
          <h1>Cài đặt cửa hàng</h1>
          <p role="alert">{error}</p>
          <button className="button button-secondary" onClick={() => void load()}>
            Thử lại
          </button>
        </section>
      </main>
    );

  async function save(form: HTMLFormElement) {
    if (!settings) return;
    const data = new FormData(form);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const current = settings;
      const next = await api.updateShopSettings(shopId, {
        expectedLockVersion: current.lockVersion,
        name: String(data.get("name") ?? "").trim(),
        timezone: String(data.get("timezone") ?? "").trim(),
        contactPhone: String(data.get("contactPhone") ?? "").trim() || null,
        orderCodePrefix: String(data.get("orderCodePrefix") ?? "")
          .trim()
          .toUpperCase(),
        intakePhotoMinimum: Number(data.get("intakePhotoMinimum")),
        defaultQuoteExpiryHours: Number(data.get("defaultQuoteExpiryHours")),
        defaultWarrantyTerms: String(data.get("defaultWarrantyTerms") ?? "").trim() || null,
      });
      setSettings(next);
      setMessage("Đã lưu cài đặt cửa hàng.");
    } catch (reason) {
      setError(safeErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function addBranch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const branch = await api.createBranch(shopId, {
        name: branchName,
        address: branchAddress || null,
      });
      setSettings((current) =>
        current ? { ...current, branches: [...current.branches, branch] } : current,
      );
      setBranchName("");
      setBranchAddress("");
      setMessage("Đã thêm chi nhánh.");
    } catch (reason) {
      setError(safeErrorMessage(reason));
    }
  }

  return (
    <main className="settings-shell">
      <header className="settings-heading">
        <div>
          <p className="eyebrow">Chủ cửa hàng</p>
          <h1>Cài đặt cửa hàng</h1>
          <p>Timezone được dùng khi hiển thị lịch sử và thời hạn nghiệp vụ.</p>
        </div>
      </header>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice notice-success" role="status">
          {message}
        </p>
      )}
      <form
        className="settings-card settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget);
        }}
      >
        <label>
          Tên cửa hàng
          <input name="name" defaultValue={settings.name} required />
        </label>
        <label>
          Múi giờ IANA
          <input
            name="timezone"
            defaultValue={settings.timezone}
            placeholder="Asia/Ho_Chi_Minh"
            required
          />
        </label>
        <label>
          Số liên hệ
          <input name="contactPhone" defaultValue={settings.contactPhone ?? ""} />
        </label>
        <label>
          Tiền tố mã phiếu
          <input
            name="orderCodePrefix"
            defaultValue={settings.orderCodePrefix}
            maxLength={8}
            required
          />
        </label>
        <label>
          Số ảnh tiếp nhận tối thiểu
          <input
            name="intakePhotoMinimum"
            type="number"
            min={0}
            max={20}
            defaultValue={settings.intakePhotoMinimum}
            required
          />
        </label>
        <label>
          Thời hạn báo giá (giờ)
          <input
            name="defaultQuoteExpiryHours"
            type="number"
            min={1}
            max={720}
            defaultValue={settings.defaultQuoteExpiryHours}
            required
          />
        </label>
        <label>
          Điều khoản bảo hành mặc định
          <textarea
            name="defaultWarrantyTerms"
            defaultValue={settings.defaultWarrantyTerms ?? ""}
          />
        </label>
        <button className="button button-primary" disabled={saving}>
          {saving ? "Đang lưu…" : "Lưu cài đặt"}
        </button>
      </form>
      <section className="settings-card">
        <h2>Chi nhánh</h2>
        <div className="settings-list">
          {settings.branches.map((branch) => (
            <article className="settings-list-row" key={branch.id}>
              <div>
                <strong>{branch.name}</strong>
                <p>{branch.address || "Chưa có địa chỉ"}</p>
              </div>
              <span>{branch.isActive ? "Đang hoạt động" : "Đã tắt"}</span>
            </article>
          ))}
        </div>
        <form className="inline-form" onSubmit={addBranch}>
          <input
            aria-label="Tên chi nhánh mới"
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
            placeholder="Tên chi nhánh"
            required
          />
          <input
            aria-label="Địa chỉ chi nhánh mới"
            value={branchAddress}
            onChange={(event) => setBranchAddress(event.target.value)}
            placeholder="Địa chỉ (tuỳ chọn)"
          />
          <button className="button button-secondary">Thêm chi nhánh</button>
        </form>
      </section>
    </main>
  );
}
