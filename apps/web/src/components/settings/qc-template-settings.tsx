"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RepairFlowApiError, safeErrorMessage } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { CreateQcTemplateInput, CurrentUser, Membership, QcTemplate } from "@/lib/api/types";

interface QcTemplateSettingsProps {
  api: RepairOrderWorkspaceApi;
  user: CurrentUser;
  search: string;
  replaceUrl(url: string): void;
}

interface TemplateItemDraft {
  localId: string;
  label: string;
  isRequired: boolean;
  allowNa: boolean;
}

type PreparedCommand = { fingerprint: string; key: string };
type Confirmation = { type: "create" } | { type: "deactivate"; template: QcTemplate };

function randomKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random}`;
}

function commandKey(current: PreparedCommand | undefined, prefix: string, payload: unknown) {
  const fingerprint = JSON.stringify(payload);
  if (current?.fingerprint === fingerprint) return current;
  return { fingerprint, key: randomKey(prefix) };
}

function newItem(): TemplateItemDraft {
  return { localId: randomKey("qc-template-item"), label: "", isRequired: true, allowNa: false };
}

function activeMemberships(user: CurrentUser): Membership[] {
  return user.memberships.filter((membership) => membership.status === "ACTIVE");
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Không xác định" : date.toLocaleString("vi-VN");
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function QcTemplateSettings({ api, user, search, replaceUrl }: QcTemplateSettingsProps) {
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const memberships = useMemo(() => activeMemberships(user), [user]);
  const requestedShop = params.get("shopId");
  const initialMembership =
    memberships.find((membership) => membership.shopId === requestedShop) ?? memberships[0];
  const [shopId, setShopId] = useState(initialMembership?.shopId ?? "");
  const membership = memberships.find((item) => item.shopId === shopId);
  const [templates, setTemplates] = useState<QcTemplate[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "success" | "error">("loading");
  const [name, setName] = useState("");
  const [items, setItems] = useState<TemplateItemDraft[]>([newItem()]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const createCommand = useRef<PreparedCommand | undefined>(undefined);
  const deactivateCommands = useRef(new Map<string, PreparedCommand>());
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement | null>(null);

  const loadTemplates = useCallback(async () => {
    if (!shopId || membership?.role !== "OWNER") return;
    setLoadState("loading");
    setError("");
    try {
      const next = await api.listQcTemplates(shopId, true);
      setTemplates(
        [...next]
          .map((template) => ({
            ...template,
            items: [...template.items].sort(
              (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
            ),
          }))
          .sort(
            (left, right) =>
              left.name.localeCompare(right.name, "vi") || right.versionNo - left.versionNo,
          ),
      );
      setLoadState("success");
    } catch (reason) {
      setError(safeErrorMessage(reason));
      setLoadState("error");
    }
  }, [api, membership?.role, shopId]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (!confirmation) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    (focusableElements(dialog)[0] ?? dialog).focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        setConfirmation(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialog ? focusableElements(dialog) : [];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      openButtonRef.current?.focus();
    };
  }, [confirmation]);

  function focusFeedback() {
    globalThis.setTimeout(() => feedbackRef.current?.focus(), 0);
  }

  function changeShop(nextShopId: string) {
    setShopId(nextShopId);
    setTemplates([]);
    setError("");
    setMessage("");
    replaceUrl(`/settings/qc?shopId=${encodeURIComponent(nextShopId)}`);
  }

  function updateItem(localId: string, patch: Partial<TemplateItemDraft>) {
    setItems((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    );
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`item:${localId}`];
      return next;
    });
  }

  function moveItem(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    setItems((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
  }

  function createInput(): CreateQcTemplateInput {
    return {
      name: name.trim(),
      items: items.map((item, index) => ({
        label: item.label.trim(),
        isRequired: item.isRequired,
        allowNa: item.allowNa,
        sortOrder: index + 1,
      })),
    };
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Tên mẫu không được để trống.";
    if (name.trim().length > 200) next.name = "Tên mẫu tối đa 200 ký tự.";
    if (items.length === 0) next.items = "Mẫu phải có ít nhất một mục kiểm tra.";
    if (items.length > 100) next.items = "Mẫu có tối đa 100 mục kiểm tra.";
    const normalized = new Set<string>();
    for (const item of items) {
      const label = item.label.trim();
      if (!label) next[`item:${item.localId}`] = "Nhãn mục không được để trống.";
      if (label.length > 500) next[`item:${item.localId}`] = "Nhãn mục tối đa 500 ký tự.";
      const identity = label.normalize("NFKC").replace(/\s+/gu, " ").toLocaleLowerCase("vi");
      if (identity && normalized.has(identity)) {
        next[`item:${item.localId}`] = "Nhãn mục bị trùng trong cùng phiên bản.";
      }
      normalized.add(identity);
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  function requestCreate() {
    if (!validate()) return;
    openButtonRef.current = document.activeElement as HTMLButtonElement | null;
    setConfirmation({ type: "create" });
  }

  function requestDeactivate(template: QcTemplate, button: HTMLButtonElement) {
    openButtonRef.current = button;
    setConfirmation({ type: "deactivate", template });
  }

  async function confirmAction() {
    if (!confirmation || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (confirmation.type === "create") {
        const input = createInput();
        const prepared = commandKey(createCommand.current, "qc-template-create", input);
        createCommand.current = prepared;
        const created = await api.createQcTemplate(shopId, input, prepared.key);
        createCommand.current = undefined;
        setName("");
        setItems([newItem()]);
        setMessage(`Đã tạo ${created.name} phiên bản ${created.versionNo}; lịch sử cũ không đổi.`);
      } else {
        const template = confirmation.template;
        const payload = { qcTemplateId: template.id };
        const prepared = commandKey(
          deactivateCommands.current.get(template.id),
          "qc-template-deactivate",
          payload,
        );
        deactivateCommands.current.set(template.id, prepared);
        await api.deactivateQcTemplate(shopId, template.id, prepared.key);
        deactivateCommands.current.delete(template.id);
        setMessage(`Đã ngừng ${template.name} phiên bản ${template.versionNo}.`);
      }
      setConfirmation(null);
      await loadTemplates();
      focusFeedback();
    } catch (reason) {
      if (reason instanceof RepairFlowApiError && reason.code === "IDEMPOTENCY_KEY_REUSED") {
        if (confirmation.type === "create") createCommand.current = undefined;
        else deactivateCommands.current.delete(confirmation.template.id);
      }
      setError(safeErrorMessage(reason));
      if (reason instanceof RepairFlowApiError) setFieldErrors(reason.fieldErrors);
      setConfirmation(null);
      focusFeedback();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!membership || membership.role !== "OWNER") {
    return (
      <main className="settings-shell centered-state">
        <span className="state-icon" aria-hidden="true">
          ×
        </span>
        <h1>Không có quyền quản lý mẫu QC</h1>
        <p role="alert">Trang này chỉ dành cho chủ cửa hàng đang hoạt động.</p>
        <Link className="button button-secondary" href={`/orders?shopId=${shopId}`}>
          Quay lại bảng phiếu
        </Link>
      </main>
    );
  }

  return (
    <main className="settings-shell">
      <header className="settings-heading">
        <div>
          <p className="eyebrow">Thiết lập cửa hàng</p>
          <h1>Mẫu kiểm tra chất lượng</h1>
          <p>Mỗi lần thay đổi tạo một phiên bản mới; các phiên bản đã dùng luôn bất biến.</p>
        </div>
        <label className="shop-selector">
          <span>Cửa hàng</span>
          <select value={shopId} onChange={(event) => changeShop(event.target.value)}>
            {memberships.map((item) => (
              <option key={item.shopId} value={item.shopId}>
                {item.shopName} · {item.role}
              </option>
            ))}
          </select>
        </label>
      </header>

      {message && (
        <p className="notice notice-success" ref={feedbackRef} role="status" tabIndex={-1}>
          {message}
        </p>
      )}
      {error && (
        <p className="notice notice-error" ref={feedbackRef} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}

      <div className="settings-grid">
        <section className="workspace-card">
          <header>
            <p className="eyebrow">Lịch sử phiên bản</p>
            <h2>Mẫu đã phát hành</h2>
          </header>
          {loadState === "loading" && (
            <div className="qc-template-loading" aria-busy="true">
              <span className="spinner" aria-hidden="true" /> Đang tải lịch sử…
            </div>
          )}
          {loadState === "error" && (
            <button className="button button-secondary" onClick={() => void loadTemplates()}>
              Thử tải lại
            </button>
          )}
          {loadState === "success" && templates.length === 0 && (
            <p className="empty-copy">Cửa hàng chưa phát hành mẫu QC nào.</p>
          )}
          {templates.length > 0 && (
            <ol className="qc-template-history">
              {templates.map((template) => (
                <li key={template.id}>
                  <header>
                    <div>
                      <strong>
                        {template.name} · v{template.versionNo}
                      </strong>
                      <small>Phát hành {dateTime(template.createdAt)}</small>
                    </div>
                    <span
                      className={`status-pill ${template.isActive ? "status-available" : "status-cancelled"}`}
                    >
                      {template.isActive ? "Đang hoạt động" : "Ngừng hoạt động"}
                    </span>
                  </header>
                  <ol>
                    {template.items.map((item) => (
                      <li key={item.id}>
                        <span>
                          {item.sortOrder}. {item.label}
                        </span>
                        <small>
                          {item.isRequired ? "Bắt buộc" : "Không bắt buộc"} ·{" "}
                          {item.allowNa ? "Cho phép N/A" : "Không N/A"}
                        </small>
                      </li>
                    ))}
                  </ol>
                  {template.isActive && (
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={(event) => requestDeactivate(template, event.currentTarget)}
                      type="button"
                    >
                      Ngừng phiên bản này
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="workspace-card qc-template-editor">
          <header>
            <p className="eyebrow">Phiên bản mới</p>
            <h2>Phát hành checklist</h2>
            <p>Dùng lại cùng tên để tạo phiên bản kế tiếp của một họ mẫu.</p>
          </header>
          <label className="field">
            <span>Tên mẫu</span>
            <input
              aria-describedby={fieldErrors.name ? "qc-template-name-error" : undefined}
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
                setFieldErrors((current) => ({ ...current, name: "" }));
              }}
              value={name}
            />
            {fieldErrors.name && (
              <small className="field-error" id="qc-template-name-error">
                {fieldErrors.name}
              </small>
            )}
          </label>
          <ol className="qc-template-item-editor">
            {items.map((item, index) => (
              <li key={item.localId}>
                <div className="qc-template-item-heading">
                  <strong>Mục {index + 1}</strong>
                  <div>
                    <button
                      aria-label={`Đưa mục ${index + 1} lên`}
                      className="text-button"
                      disabled={index === 0}
                      onClick={() => moveItem(index, -1)}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Đưa mục ${index + 1} xuống`}
                      className="text-button"
                      disabled={index === items.length - 1}
                      onClick={() => moveItem(index, 1)}
                      type="button"
                    >
                      ↓
                    </button>
                    <button
                      className="text-button"
                      disabled={items.length === 1}
                      onClick={() =>
                        setItems((current) =>
                          current.filter((entry) => entry.localId !== item.localId),
                        )
                      }
                      type="button"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
                <label className="field">
                  <span>Nhãn kiểm tra</span>
                  <input
                    aria-describedby={
                      fieldErrors[`item:${item.localId}`]
                        ? `qc-item-error-${item.localId}`
                        : undefined
                    }
                    maxLength={500}
                    onChange={(event) => updateItem(item.localId, { label: event.target.value })}
                    value={item.label}
                  />
                  {fieldErrors[`item:${item.localId}`] && (
                    <small className="field-error" id={`qc-item-error-${item.localId}`}>
                      {fieldErrors[`item:${item.localId}`]}
                    </small>
                  )}
                </label>
                <div className="qc-template-flags">
                  <label>
                    <input
                      checked={item.isRequired}
                      onChange={(event) =>
                        updateItem(item.localId, { isRequired: event.target.checked })
                      }
                      type="checkbox"
                    />
                    Bắt buộc
                  </label>
                  <label>
                    <input
                      checked={item.allowNa}
                      onChange={(event) =>
                        updateItem(item.localId, { allowNa: event.target.checked })
                      }
                      type="checkbox"
                    />
                    Cho phép Không áp dụng
                  </label>
                </div>
              </li>
            ))}
          </ol>
          {fieldErrors.items && <small className="field-error">{fieldErrors.items}</small>}
          <div className="qc-template-actions">
            <button
              className="button button-secondary"
              disabled={items.length >= 100}
              onClick={() => setItems((current) => [...current, newItem()])}
              type="button"
            >
              Thêm mục
            </button>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={requestCreate}
              type="button"
            >
              Xem lại và phát hành
            </button>
          </div>
        </section>
      </div>

      {confirmation && (
        <div className="qc-dialog-backdrop">
          <div
            aria-describedby="qc-settings-confirm-description"
            aria-labelledby="qc-settings-confirm-title"
            aria-modal="true"
            className="qc-dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="qc-settings-confirm-title">
              {confirmation.type === "create"
                ? "Phát hành phiên bản mới?"
                : "Ngừng mẫu đang hoạt động?"}
            </h2>
            <p id="qc-settings-confirm-description">
              {confirmation.type === "create"
                ? `${name.trim()} sẽ được lưu thành một phiên bản bất biến với ${items.length} mục.`
                : `${confirmation.template.name} v${confirmation.template.versionNo} sẽ không dùng cho lần QC mới.`}{" "}
              Các lần QC và phiên bản lịch sử đã có sẽ không thay đổi.
            </p>
            <div className="qc-dialog-actions">
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => setConfirmation(null)}
                type="button"
              >
                Hủy
              </button>
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => void confirmAction()}
                type="button"
              >
                {busy ? "Đang xử lý…" : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
