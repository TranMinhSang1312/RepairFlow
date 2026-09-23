"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { RepairFlowApiError, safeErrorMessage } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type {
  CreateQuoteInput,
  Membership,
  Quote,
  QuoteItemKind,
  QuoteSendChannel,
  RepairOrderDetail,
} from "@/lib/api/types";

interface QuotePanelProps {
  api: RepairOrderWorkspaceApi;
  membership: Membership;
  order: RepairOrderDetail;
  shopId: string;
  onReload(): Promise<void>;
}

interface EditableQuoteItem {
  clientId: string;
  kind: QuoteItemKind;
  description: string;
  quantity: string;
  unitPrice: string;
  isOptional: boolean;
  approvalGroup: string;
}

interface QuoteFormState {
  diagnosisId: string;
  discount: string;
  customerNote: string;
  expiresAt: string;
  items: EditableQuoteItem[];
}

interface QuotePreview {
  lineTotals: number[];
  subtotal: number;
  discount: number;
  total: number;
}

const COPY_LINK_CHANNEL: QuoteSendChannel = "COPY_LINK";

const STATUS_LABELS = {
  DRAFT: "Bản nháp",
  SENT: "Đã gửi",
  ACCEPTED: "Đã chấp nhận",
  PARTIALLY_ACCEPTED: "Chấp nhận một phần",
  DECLINED: "Đã từ chối",
  EXPIRED: "Đã hết hạn",
  SUPERSEDED: "Đã thay thế",
} as const;

const KIND_LABELS: Readonly<Record<QuoteItemKind, string>> = {
  SERVICE: "Dịch vụ",
  PART: "Linh kiện",
  FEE: "Chi phí khác",
};

function newClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `quote-item-${Date.now()}-${Math.random()}`;
}

function newItem(): EditableQuoteItem {
  return {
    clientId: newClientId(),
    kind: "SERVICE",
    description: "",
    quantity: "1",
    unitPrice: "0",
    isOptional: false,
    approvalGroup: "",
  };
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formFromQuote(quote?: Quote): QuoteFormState {
  if (!quote) {
    return {
      diagnosisId: "",
      discount: "0",
      customerNote: "",
      expiresAt: "",
      items: [newItem()],
    };
  }
  return {
    diagnosisId: quote.diagnosisId ?? "",
    discount: String(quote.discount),
    customerNote: quote.customerNote ?? "",
    expiresAt: localDateTime(quote.expiresAt),
    items: quote.items.map((item) => ({
      clientId: item.id,
      kind: item.kind,
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: String(item.unitPrice),
      isOptional: item.isOptional,
      approvalGroup: item.approvalGroup ?? "",
    })),
  };
}

function money(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function dateTime(value: string | null): string {
  if (!value) return "Theo mặc định của cửa hàng";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Không xác định" : date.toLocaleString("vi-VN");
}

function previewFor(form: QuoteFormState): QuotePreview {
  const lineTotals = form.items.map((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    return Number.isFinite(quantity) && Number.isFinite(unitPrice)
      ? Math.round(quantity * unitPrice)
      : 0;
  });
  const subtotal = lineTotals.reduce((sum, line) => sum + line, 0);
  const discount = Number(form.discount);
  return {
    lineTotals,
    subtotal,
    discount: Number.isSafeInteger(discount) && discount >= 0 ? discount : 0,
    total: Math.max(0, subtotal - (Number.isSafeInteger(discount) ? discount : 0)),
  };
}

function previewFromQuote(quote: Quote): QuotePreview {
  return {
    lineTotals: quote.items.map((item) => item.lineTotal),
    subtotal: quote.subtotal,
    discount: quote.discount,
    total: quote.total,
  };
}

function matchesAuthoritativeTotals(quote: Quote, preview: QuotePreview): boolean {
  return (
    quote.items.length === preview.lineTotals.length &&
    quote.items.every((item, index) => item.lineTotal === preview.lineTotals[index]) &&
    quote.subtotal === preview.subtotal &&
    quote.discount === preview.discount &&
    quote.total === preview.total
  );
}

function toInput(form: QuoteFormState): CreateQuoteInput {
  return {
    diagnosisId: form.diagnosisId || null,
    discount: Number(form.discount),
    customerNote: form.customerNote.trim() || null,
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    items: form.items.map((item) => ({
      kind: item.kind,
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      isOptional: item.isOptional,
      approvalGroup: item.isOptional ? item.approvalGroup.trim() || null : null,
    })),
  };
}

function sendKey(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `quote-send-${random}`;
}

export function QuotePanel({ api, membership, order, shopId, onReload }: QuotePanelProps) {
  const quoteVersions = useMemo(() => order.quoteVersions ?? [], [order.quoteVersions]);
  const highestDraft = useMemo(
    () =>
      quoteVersions
        .filter((quote) => quote.status === "DRAFT")
        .sort((left, right) => right.versionNo - left.versionNo)[0],
    [quoteVersions],
  );
  const [form, setForm] = useState<QuoteFormState>(() => formFromQuote(highestDraft));
  const [savedQuote, setSavedQuote] = useState<Quote | null>(highestDraft ?? null);
  const [authoritativePreview, setAuthoritativePreview] = useState<QuotePreview | null>(() =>
    highestDraft ? previewFromQuote(highestDraft) : null,
  );
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [needsTotalReview, setNeedsTotalReview] = useState(false);
  const [confirmQuote, setConfirmQuote] = useState<Quote | null>(null);
  const [linkAvailable, setLinkAvailable] = useState(false);
  const publicUrlRef = useRef<string | null>(null);
  const sendKeyRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const sendingRef = useRef(false);
  const localMutationRef = useRef<Pick<Quote, "id" | "status" | "updatedAt"> | null>(null);
  const dialogInitialFocusRef = useRef<HTMLButtonElement | null>(null);
  const sendTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (dirty || saving || sending) return;
    const localMutation = localMutationRef.current;
    if (localMutation) {
      const serverQuote = quoteVersions.find((quote) => quote.id === localMutation.id);
      if (
        !serverQuote ||
        serverQuote.status !== localMutation.status ||
        serverQuote.updatedAt !== localMutation.updatedAt
      ) {
        return;
      }
      localMutationRef.current = null;
    }
    setSavedQuote(highestDraft ?? null);
    setForm(formFromQuote(highestDraft));
    setAuthoritativePreview(highestDraft ? previewFromQuote(highestDraft) : null);
  }, [dirty, highestDraft, quoteVersions, saving, sending]);

  useEffect(() => {
    if (confirmQuote) dialogInitialFocusRef.current?.focus();
  }, [confirmQuote]);

  useEffect(
    () => () => {
      publicUrlRef.current = null;
      sendKeyRef.current = null;
    },
    [],
  );

  const roleMayMutate = membership.role === "OWNER" || membership.role === "RECEPTIONIST";
  const stateMayEdit = order.status === "DIAGNOSING" || order.status === "REPAIRING";
  const stateMaySend = stateMayEdit || order.status === "AWAITING_APPROVAL";
  const savedFinalizedCurrent = Boolean(
    savedQuote && savedQuote.status !== "DRAFT" && highestDraft?.id === savedQuote.id,
  );
  const canEdit = roleMayMutate && stateMayEdit && !savedFinalizedCurrent;
  const activeDraft =
    savedQuote?.status === "DRAFT"
      ? savedQuote
      : savedQuote && highestDraft?.id === savedQuote.id
        ? undefined
        : highestDraft;
  const clientPreview = useMemo(() => previewFor(form), [form]);
  const preview = authoritativePreview ?? clientPreview;
  const displayQuotes = useMemo(() => {
    const replaced = savedQuote
      ? quoteVersions.map((quote) => (quote.id === savedQuote.id ? savedQuote : quote))
      : quoteVersions;
    const includesSaved = savedQuote && !replaced.some((quote) => quote.id === savedQuote.id);
    return [...(includesSaved ? [...replaced, savedQuote] : replaced)].sort(
      (left, right) => right.versionNo - left.versionNo,
    );
  }, [quoteVersions, savedQuote]);

  function updateForm(update: (current: QuoteFormState) => QuoteFormState) {
    setForm(update);
    setAuthoritativePreview(null);
    setDirty(true);
    setFieldErrors({});
    setNeedsTotalReview(false);
    setMessage("");
    setError("");
    setLinkAvailable(false);
    publicUrlRef.current = null;
    sendKeyRef.current = null;
  }

  function updateItem(index: number, update: Partial<EditableQuoteItem>) {
    updateForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...update } : item,
      ),
    }));
  }

  function moveItem(index: number, direction: -1 | 1) {
    updateForm((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.items.length) return current;
      const items = [...current.items];
      const [item] = items.splice(index, 1);
      if (item) items.splice(target, 0, item);
      return { ...current, items };
    });
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (form.items.length === 0) next.items = "Báo giá cần ít nhất một hạng mục.";
    if (form.items.length > 100) next.items = "Báo giá có tối đa 100 hạng mục.";

    form.items.forEach((item, index) => {
      if (!item.description.trim()) {
        next[`items.${index}.description`] = "Vui lòng nhập mô tả hạng mục.";
      } else if (item.description.trim().length > 500) {
        next[`items.${index}.description`] = "Mô tả tối đa 500 ký tự.";
      }
      if (
        !/^\d+(?:\.\d{1,2})?$/.test(item.quantity) ||
        Number(item.quantity) <= 0 ||
        Number(item.quantity) > 9_999_999_999.99
      ) {
        next[`items.${index}.quantity`] =
          "Số lượng phải từ 0,01 đến 9.999.999.999,99 và có tối đa 2 số lẻ.";
      }
      if (!/^\d+$/.test(item.unitPrice) || !Number.isSafeInteger(Number(item.unitPrice))) {
        next[`items.${index}.unitPrice`] = "Đơn giá phải là số nguyên VND không âm.";
      }
      if (item.approvalGroup.trim().length > 80) {
        next[`items.${index}.approvalGroup`] = "Nhóm duyệt tối đa 80 ký tự.";
      }
    });

    if (!/^\d+$/.test(form.discount) || !Number.isSafeInteger(Number(form.discount))) {
      next.discount = "Giảm giá phải là số nguyên VND không âm.";
    } else if (Number(form.discount) > preview.subtotal) {
      next.discount = "Giảm giá không được lớn hơn tạm tính.";
    }
    if (form.customerNote.length > 3000) {
      next.customerNote = "Ghi chú tối đa 3.000 ký tự.";
    }
    if (form.expiresAt) {
      const expiresAt = new Date(form.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        next.expiresAt = "Thời hạn báo giá phải ở tương lai.";
      }
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function saveDraft() {
    if (savingRef.current || !canEdit || !validate()) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    const submittedPreview = clientPreview;
    try {
      const input = toInput(form);
      const quote = activeDraft
        ? await api.replaceDraftQuote(shopId, activeDraft.id, input)
        : await api.createQuote(shopId, order.id, input);
      const totalsChanged = !matchesAuthoritativeTotals(quote, submittedPreview);
      localMutationRef.current = quote;
      setSavedQuote(quote);
      setForm(formFromQuote(quote));
      setAuthoritativePreview(previewFromQuote(quote));
      setDirty(false);
      setFieldErrors({});
      setNeedsTotalReview(totalsChanged);
      setLinkAvailable(false);
      publicUrlRef.current = null;
      sendKeyRef.current = null;
      setMessage(
        totalsChanged
          ? "Máy chủ đã điều chỉnh tổng tiền. Hãy kiểm tra lại trước khi gửi."
          : `Đã lưu báo giá #${quote.versionNo} với tổng tiền do máy chủ xác nhận.`,
      );
      try {
        await onReload();
      } catch {
        setError("Báo giá đã được lưu nhưng workspace chưa thể làm mới.");
      }
    } catch (reason) {
      if (reason instanceof RepairFlowApiError) setFieldErrors(reason.fieldErrors);
      setError(safeErrorMessage(reason));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function openSendConfirmation() {
    if (!activeDraft || dirty || needsTotalReview || !roleMayMutate || !stateMaySend) return;
    setError("");
    setMessage("");
    sendKeyRef.current ??= sendKey();
    setConfirmQuote(activeDraft);
  }

  function cancelSendConfirmation() {
    if (sendingRef.current) return;
    setConfirmQuote(null);
    sendKeyRef.current = null;
    queueMicrotask(() => sendTriggerRef.current?.focus());
  }

  async function sendDraft() {
    if (!confirmQuote || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      const result = await api.sendQuote(
        shopId,
        confirmQuote.id,
        COPY_LINK_CHANNEL,
        (sendKeyRef.current ??= sendKey()),
      );
      publicUrlRef.current = result.publicUrl;
      localMutationRef.current = result.quote;
      setLinkAvailable(true);
      setSavedQuote(result.quote);
      setConfirmQuote(null);
      setDirty(false);
      setNeedsTotalReview(false);
      sendKeyRef.current = null;
      setMessage(`Đã gửi báo giá #${result.quote.versionNo}. Liên kết đang sẵn sàng để sao chép.`);
      try {
        await onReload();
      } catch {
        setError("Báo giá đã được gửi nhưng workspace chưa thể làm mới.");
      }
    } catch (reason) {
      setError(safeErrorMessage(reason));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function copyPublicLink() {
    const publicUrl = publicUrlRef.current;
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setMessage("Đã sao chép liên kết khách hàng.");
      setError("");
    } catch {
      setError("Trình duyệt không cho phép sao chép. Hãy cấp quyền clipboard rồi thử lại.");
    }
  }

  return (
    <section className="quote-layout" id="quote-panel" role="tabpanel">
      <article className="workspace-card quote-history">
        <header>
          <p className="eyebrow">Lịch sử bất biến</p>
          <h2>{displayQuotes.length} phiên bản báo giá</h2>
          <p>Phiên bản đã gửi hoặc đã có quyết định chỉ được xem, không thể sửa.</p>
        </header>
        {displayQuotes.length ? (
          <ol className="quote-version-list">
            {displayQuotes.map((quote) => (
              <li key={quote.id} className="quote-version-card">
                <div className="quote-version-heading">
                  <div>
                    <strong>Báo giá #{quote.versionNo}</strong>
                    <span className={`quote-status quote-status-${quote.status.toLowerCase()}`}>
                      {STATUS_LABELS[quote.status]}
                    </span>
                  </div>
                  <time dateTime={quote.updatedAt}>{dateTime(quote.updatedAt)}</time>
                </div>
                <ul className="quote-readonly-items">
                  {quote.items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.description}</strong>
                        <small>
                          {KIND_LABELS[item.kind]} · {item.isOptional ? "Tùy chọn" : "Bắt buộc"}
                          {item.approvalGroup ? ` · Nhóm ${item.approvalGroup}` : ""}
                        </small>
                      </div>
                      <span>
                        {item.quantity} × {money(item.unitPrice)} = {money(item.lineTotal)}
                      </span>
                    </li>
                  ))}
                </ul>
                <dl className="quote-totals compact-facts">
                  <div>
                    <dt>Tạm tính</dt>
                    <dd>{money(quote.subtotal)}</dd>
                  </div>
                  <div>
                    <dt>Giảm giá</dt>
                    <dd>{money(quote.discount)}</dd>
                  </div>
                  <div>
                    <dt>Tổng cộng</dt>
                    <dd>{money(quote.total)}</dd>
                  </div>
                  <div>
                    <dt>Hết hạn</dt>
                    <dd>{dateTime(quote.expiresAt)}</dd>
                  </div>
                </dl>
                {quote.customerNote && <p className="quote-customer-note">{quote.customerNote}</p>}
                {quote.status !== "DRAFT" && (
                  <p className="binding-note">Phiên bản này đã được khóa và không thể chỉnh sửa.</p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty-copy">Chưa có báo giá nào cho phiếu này.</p>
        )}
      </article>

      {canEdit && (
        <form
          className="workspace-card quote-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void saveDraft();
          }}
        >
          <header>
            <p className="eyebrow">
              {activeDraft ? `Bản nháp #${activeDraft.versionNo}` : "Bản nháp mới"}
            </p>
            <h2>Chuẩn bị báo giá</h2>
            <p>Tổng tiền bên dưới là bản xem trước. Máy chủ sẽ tính và xác nhận khi lưu.</p>
          </header>

          <label className="field" htmlFor="quote-diagnosis">
            <span>Chẩn đoán tham chiếu</span>
            <select
              id="quote-diagnosis"
              onChange={(event) =>
                updateForm((current) => ({ ...current, diagnosisId: event.target.value }))
              }
              value={form.diagnosisId}
            >
              <option value="">Không chọn</option>
              {order.diagnoses.map((diagnosis) => (
                <option key={diagnosis.id} value={diagnosis.id}>
                  Chẩn đoán #{diagnosis.revisionNo}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="quote-items-fieldset">
            <legend>Hạng mục báo giá</legend>
            {fieldErrors.items && <p className="field-error">{fieldErrors.items}</p>}
            <div className="quote-editable-items">
              {form.items.map((item, index) => (
                <fieldset className="quote-item-editor" key={item.clientId}>
                  <legend>Hạng mục {index + 1}</legend>
                  <label className="field" htmlFor={`quote-kind-${item.clientId}`}>
                    <span>Loại</span>
                    <select
                      id={`quote-kind-${item.clientId}`}
                      onChange={(event) =>
                        updateItem(index, { kind: event.target.value as QuoteItemKind })
                      }
                      value={item.kind}
                    >
                      {Object.entries(KIND_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className="field quote-description"
                    htmlFor={`quote-description-${item.clientId}`}
                  >
                    <span>Mô tả</span>
                    <input
                      aria-describedby={
                        fieldErrors[`items.${index}.description`]
                          ? `quote-description-${item.clientId}-error`
                          : undefined
                      }
                      id={`quote-description-${item.clientId}`}
                      maxLength={500}
                      onChange={(event) => updateItem(index, { description: event.target.value })}
                      value={item.description}
                    />
                    {fieldErrors[`items.${index}.description`] && (
                      <small
                        className="field-error"
                        id={`quote-description-${item.clientId}-error`}
                      >
                        {fieldErrors[`items.${index}.description`]}
                      </small>
                    )}
                  </label>
                  <label className="field" htmlFor={`quote-quantity-${item.clientId}`}>
                    <span>Số lượng</span>
                    <input
                      aria-describedby={
                        fieldErrors[`items.${index}.quantity`]
                          ? `quote-quantity-${item.clientId}-error`
                          : undefined
                      }
                      id={`quote-quantity-${item.clientId}`}
                      inputMode="decimal"
                      min="0.01"
                      onChange={(event) => updateItem(index, { quantity: event.target.value })}
                      step="0.01"
                      type="number"
                      value={item.quantity}
                    />
                    {fieldErrors[`items.${index}.quantity`] && (
                      <small className="field-error" id={`quote-quantity-${item.clientId}-error`}>
                        {fieldErrors[`items.${index}.quantity`]}
                      </small>
                    )}
                  </label>
                  <label className="field" htmlFor={`quote-price-${item.clientId}`}>
                    <span>Đơn giá (VND)</span>
                    <input
                      aria-describedby={
                        fieldErrors[`items.${index}.unitPrice`]
                          ? `quote-price-${item.clientId}-error`
                          : undefined
                      }
                      id={`quote-price-${item.clientId}`}
                      inputMode="numeric"
                      min="0"
                      onChange={(event) => updateItem(index, { unitPrice: event.target.value })}
                      step="1"
                      type="number"
                      value={item.unitPrice}
                    />
                    {fieldErrors[`items.${index}.unitPrice`] && (
                      <small className="field-error" id={`quote-price-${item.clientId}-error`}>
                        {fieldErrors[`items.${index}.unitPrice`]}
                      </small>
                    )}
                  </label>
                  <label className="quote-optional-control">
                    <input
                      checked={item.isOptional}
                      onChange={(event) =>
                        updateItem(index, {
                          isOptional: event.target.checked,
                          ...(!event.target.checked ? { approvalGroup: "" } : {}),
                        })
                      }
                      type="checkbox"
                    />
                    Hạng mục tùy chọn
                  </label>
                  {item.isOptional && (
                    <label className="field" htmlFor={`quote-group-${item.clientId}`}>
                      <span>Nhóm duyệt (không bắt buộc)</span>
                      <input
                        aria-describedby={
                          fieldErrors[`items.${index}.approvalGroup`]
                            ? `quote-group-${item.clientId}-error`
                            : undefined
                        }
                        id={`quote-group-${item.clientId}`}
                        maxLength={80}
                        onChange={(event) =>
                          updateItem(index, { approvalGroup: event.target.value })
                        }
                        value={item.approvalGroup}
                      />
                      {fieldErrors[`items.${index}.approvalGroup`] && (
                        <small className="field-error" id={`quote-group-${item.clientId}-error`}>
                          {fieldErrors[`items.${index}.approvalGroup`]}
                        </small>
                      )}
                    </label>
                  )}
                  <output className="quote-line-total" aria-live="polite">
                    Thành tiền: {money(preview.lineTotals[index] ?? 0)}
                  </output>
                  <div className="quote-item-actions">
                    <button
                      aria-label={`Đưa hạng mục ${index + 1} lên`}
                      className="button button-secondary"
                      disabled={index === 0}
                      onClick={() => moveItem(index, -1)}
                      type="button"
                    >
                      Lên
                    </button>
                    <button
                      aria-label={`Đưa hạng mục ${index + 1} xuống`}
                      className="button button-secondary"
                      disabled={index === form.items.length - 1}
                      onClick={() => moveItem(index, 1)}
                      type="button"
                    >
                      Xuống
                    </button>
                    <button
                      aria-label={`Xóa hạng mục ${index + 1}`}
                      className="button button-secondary"
                      onClick={() =>
                        updateForm((current) => ({
                          ...current,
                          items: current.items.filter((_, itemIndex) => itemIndex !== index),
                        }))
                      }
                      type="button"
                    >
                      Xóa
                    </button>
                  </div>
                </fieldset>
              ))}
            </div>
            <button
              className="button button-secondary"
              disabled={form.items.length >= 100}
              onClick={() =>
                updateForm((current) => ({ ...current, items: [...current.items, newItem()] }))
              }
              type="button"
            >
              Thêm hạng mục
            </button>
          </fieldset>

          <div className="quote-settings">
            <label className="field" htmlFor="quote-discount">
              <span>Giảm giá (VND)</span>
              <input
                aria-describedby={fieldErrors.discount ? "quote-discount-error" : undefined}
                id="quote-discount"
                inputMode="numeric"
                min="0"
                onChange={(event) =>
                  updateForm((current) => ({ ...current, discount: event.target.value }))
                }
                step="1"
                type="number"
                value={form.discount}
              />
              {fieldErrors.discount && (
                <small className="field-error" id="quote-discount-error">
                  {fieldErrors.discount}
                </small>
              )}
            </label>
            <label className="field" htmlFor="quote-expires-at">
              <span>Hết hạn lúc</span>
              <input
                aria-describedby={fieldErrors.expiresAt ? "quote-expires-at-error" : undefined}
                id="quote-expires-at"
                onChange={(event) =>
                  updateForm((current) => ({ ...current, expiresAt: event.target.value }))
                }
                type="datetime-local"
                value={form.expiresAt}
              />
              {fieldErrors.expiresAt && (
                <small className="field-error" id="quote-expires-at-error">
                  {fieldErrors.expiresAt}
                </small>
              )}
            </label>
          </div>
          <label className="field" htmlFor="quote-customer-note">
            <span>Ghi chú gửi khách</span>
            <textarea
              aria-describedby={fieldErrors.customerNote ? "quote-customer-note-error" : undefined}
              id="quote-customer-note"
              maxLength={3000}
              onChange={(event) =>
                updateForm((current) => ({ ...current, customerNote: event.target.value }))
              }
              rows={4}
              value={form.customerNote}
            />
            {fieldErrors.customerNote && (
              <small className="field-error" id="quote-customer-note-error">
                {fieldErrors.customerNote}
              </small>
            )}
          </label>

          <aside className="quote-preview" aria-label="Tổng tiền xem trước">
            <p>Tổng tiền xem trước</p>
            <dl>
              <div>
                <dt>Tạm tính</dt>
                <dd>{money(preview.subtotal)}</dd>
              </div>
              <div>
                <dt>Giảm giá</dt>
                <dd>{money(preview.discount)}</dd>
              </div>
              <div>
                <dt>Tổng cộng</dt>
                <dd>{money(preview.total)}</dd>
              </div>
            </dl>
            <small>Máy chủ là nguồn xác nhận tổng tiền cuối cùng.</small>
          </aside>

          {needsTotalReview && (
            <div className="notice notice-info" role="status">
              <p>Tổng tiền do máy chủ trả về khác bản xem trước. Dữ liệu đã được cập nhật.</p>
              <button
                className="button button-secondary"
                onClick={() => {
                  setNeedsTotalReview(false);
                  setMessage("Đã xác nhận xem lại tổng tiền do máy chủ tính.");
                }}
                type="button"
              >
                Tôi đã kiểm tra tổng tiền
              </button>
            </div>
          )}

          <div className="quote-editor-actions">
            <button className="button button-primary" disabled={saving || sending} type="submit">
              {saving ? "Đang lưu…" : activeDraft ? "Lưu bản nháp" : "Tạo bản nháp"}
            </button>
            {activeDraft && (
              <button
                className="button button-secondary"
                disabled={dirty || needsTotalReview || saving || sending || !stateMaySend}
                onClick={openSendConfirmation}
                ref={sendTriggerRef}
                type="button"
              >
                Xem lại và gửi
              </button>
            )}
          </div>
        </form>
      )}

      {!canEdit && roleMayMutate && activeDraft?.status === "DRAFT" && stateMaySend && (
        <article className="workspace-card quote-send-ready">
          <h2>Bản nháp #{activeDraft.versionNo} đã sẵn sàng</h2>
          <p>
            Phiếu đang chờ duyệt nên bản nháp không thể sửa. Bạn vẫn có thể gửi phiên bản đã chuẩn
            bị.
          </p>
          <button
            className="button button-primary"
            disabled={sending}
            onClick={openSendConfirmation}
            ref={sendTriggerRef}
            type="button"
          >
            Xem lại và gửi
          </button>
        </article>
      )}

      {linkAvailable && (
        <article className="workspace-card quote-link-result" role="status">
          <h2>Liên kết khách hàng đã sẵn sàng</h2>
          <p>
            Liên kết bảo mật không được hiển thị trên màn hình và chỉ được giữ tạm trong phiên này.
          </p>
          <button
            className="button button-primary"
            onClick={() => void copyPublicLink()}
            type="button"
          >
            Sao chép liên kết khách hàng
          </button>
        </article>
      )}

      {message && (
        <p className="notice notice-success quote-feedback" role="status">
          {message}
        </p>
      )}
      {error && !confirmQuote && (
        <p className="notice notice-error quote-feedback" role="alert">
          {error}
        </p>
      )}

      {confirmQuote && (
        <div
          aria-labelledby="quote-send-title"
          aria-modal="true"
          className="quote-dialog-backdrop"
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelSendConfirmation();
            if (event.key === "Tab") {
              const focusable = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
              );
              const first = focusable[0];
              const last = focusable.at(-1);
              if (!first || !last) return;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }
          }}
          role="dialog"
        >
          <section className="quote-dialog">
            <header>
              <p className="eyebrow">Xác nhận gửi</p>
              <h2 id="quote-send-title">Gửi báo giá #{confirmQuote.versionNo}</h2>
            </header>
            <p className="notice notice-info">
              Sau khi gửi, phiên bản này sẽ bị khóa vĩnh viễn và phiếu chuyển sang chờ khách duyệt.
            </p>
            <ul className="quote-confirm-items">
              {confirmQuote.items.map((item) => (
                <li key={item.id}>
                  <span>{item.description}</span>
                  <strong>{money(item.lineTotal)}</strong>
                </li>
              ))}
            </ul>
            <dl className="quote-confirm-summary">
              <div>
                <dt>Tổng cộng</dt>
                <dd>{money(confirmQuote.total)}</dd>
              </div>
              <div>
                <dt>Hết hạn</dt>
                <dd>{dateTime(confirmQuote.expiresAt)}</dd>
              </div>
              <div>
                <dt>Kênh</dt>
                <dd>Sao chép liên kết</dd>
              </div>
            </dl>
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            <div className="quote-dialog-actions">
              <button
                className="button button-secondary"
                disabled={sending}
                onClick={cancelSendConfirmation}
                ref={dialogInitialFocusRef}
                type="button"
              >
                Quay lại
              </button>
              <button
                className="button button-primary"
                disabled={sending}
                onClick={() => void sendDraft()}
                type="button"
              >
                {sending ? "Đang gửi…" : "Xác nhận gửi và khóa"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
