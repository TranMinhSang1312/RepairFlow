"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RepairFlowApiError } from "@/lib/api/errors";
import { BrowserPublicPortalApi, type PublicPortalApi } from "@/lib/api/public-api";
import type {
  PublicOrder,
  PublicQuote,
  PublicQuoteItem,
  QuoteDecision,
  QuoteDecisionInput,
  QuoteDecisionResult,
  RepairOrderStatus,
} from "@/lib/api/types";

type LoadState = "loading" | "ready" | "error";
type PublicErrorKind = "invalid" | "expired" | "unavailable" | "rate-limited" | "network";

interface DecisionReview {
  decision: QuoteDecision;
  input: QuoteDecisionInput;
  selectedItems: PublicQuoteItem[];
  previewTotal: number;
  signature: string;
}

interface SelectionUnit {
  key: string;
  label: string;
  items: PublicQuoteItem[];
  required: boolean;
}

const STATUS_LABELS: Readonly<Record<RepairOrderStatus, string>> = {
  RECEIVED: "Đã tiếp nhận",
  DIAGNOSING: "Đang kiểm tra",
  AWAITING_APPROVAL: "Chờ khách hàng duyệt",
  APPROVED: "Đã duyệt sửa chữa",
  WAITING_PARTS: "Đang chờ linh kiện",
  REPAIRING: "Đang sửa chữa",
  QUALITY_CHECK: "Đang kiểm tra chất lượng",
  READY_FOR_PICKUP: "Sẵn sàng bàn giao",
  COMPLETED: "Đã hoàn tất",
  VOIDED: "Đã hủy",
};

const DECISION_LABELS: Readonly<Record<QuoteDecision, string>> = {
  ACCEPTED: "Đã đồng ý toàn bộ báo giá",
  PARTIALLY_ACCEPTED: "Đã đồng ý một phần báo giá",
  DECLINED: "Đã từ chối báo giá",
};

const ITEM_KIND_LABELS = {
  SERVICE: "Dịch vụ",
  PART: "Linh kiện",
  FEE: "Chi phí",
} as const;

function formatMoney(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `decision-${Date.now()}-${Math.random()}`;
}

function errorKind(error: unknown): PublicErrorKind {
  if (error instanceof RepairFlowApiError) {
    if (error.code === "PUBLIC_LINK_EXPIRED") return "expired";
    if (error.code === "PUBLIC_QUOTE_UNAVAILABLE") return "unavailable";
    if (error.code === "RATE_LIMITED" || error.status === 429) return "rate-limited";
    if (error.code === "PUBLIC_LINK_INVALID" || error.status === 404) return "invalid";
  }
  return "network";
}

function errorContent(kind: PublicErrorKind): { title: string; message: string; retry: boolean } {
  switch (kind) {
    case "invalid":
      return {
        title: "Liên kết không hợp lệ",
        message:
          "Liên kết này không tồn tại hoặc không còn hoạt động. Hãy liên hệ cửa hàng để được hỗ trợ.",
        retry: false,
      };
    case "expired":
      return {
        title: "Liên kết đã hết hạn",
        message:
          "Thời hạn sử dụng liên kết đã kết thúc. Hãy liên hệ cửa hàng để nhận liên kết mới.",
        retry: false,
      };
    case "unavailable":
      return {
        title: "Báo giá không còn hiệu lực",
        message:
          "Báo giá đã hết hạn hoặc được thay bằng phiên bản mới. Hãy liên hệ cửa hàng để kiểm tra.",
        retry: false,
      };
    case "rate-limited":
      return {
        title: "Bạn thao tác quá nhanh",
        message: "Vui lòng chờ một lúc rồi tải lại trang.",
        retry: true,
      };
    case "network":
      return {
        title: "Chưa thể tải thông tin",
        message: "Không thể kết nối với máy chủ. Hãy kiểm tra mạng và thử lại.",
        retry: true,
      };
  }
}

function selectionUnits(quote: PublicQuote): SelectionUnit[] {
  const units: SelectionUnit[] = [];
  const groupIndexes = new Map<string, number>();

  for (const item of quote.items) {
    if (!item.isOptional) {
      units.push({
        key: `required-${item.id}`,
        label: item.description,
        items: [item],
        required: true,
      });
      continue;
    }
    if (!item.approvalGroup) {
      units.push({
        key: `optional-${item.id}`,
        label: item.description,
        items: [item],
        required: false,
      });
      continue;
    }

    const existingIndex = groupIndexes.get(item.approvalGroup);
    if (existingIndex === undefined) {
      groupIndexes.set(item.approvalGroup, units.length);
      units.push({
        key: `group-${item.approvalGroup}`,
        label: item.approvalGroup,
        items: [item],
        required: false,
      });
    } else {
      units[existingIndex]!.items.push(item);
    }
  }

  return units;
}

function optionalIds(quote: PublicQuote): string[] {
  return quote.items.filter((item) => item.isOptional).map((item) => item.id);
}

function selectedQuoteItems(quote: PublicQuote, selectedOptionalIds: ReadonlySet<string>) {
  return quote.items.filter((item) => !item.isOptional || selectedOptionalIds.has(item.id));
}

function approvedTotal(items: PublicQuoteItem[], discount: number): number {
  return Math.max(0, items.reduce((sum, item) => sum + item.lineTotal, 0) - discount);
}

function decisionFromStatus(status: PublicQuote["status"]): QuoteDecision | null {
  return status === "SENT" ? null : status;
}

function PublicState({ kind, onRetry }: { kind: PublicErrorKind; onRetry(): void }) {
  const content = errorContent(kind);
  return (
    <main className="public-portal-shell public-state-shell">
      <section className="public-state-card" role="alert">
        <span className="state-icon" aria-hidden="true">
          !
        </span>
        <p className="eyebrow">RepairFlow</p>
        <h1>{content.title}</h1>
        <p>{content.message}</p>
        {content.retry && (
          <button className="button button-primary" onClick={onRetry} type="button">
            Thử lại
          </button>
        )}
      </section>
    </main>
  );
}

function QuoteItems({
  quote,
  selectedOptionalIds,
  disabled,
  readOnly,
  onToggle,
}: {
  quote: PublicQuote;
  selectedOptionalIds: ReadonlySet<string>;
  disabled: boolean;
  readOnly: boolean;
  onToggle(ids: string[], checked: boolean): void;
}) {
  return (
    <fieldset className="public-quote-items" disabled={disabled}>
      <legend>Phạm vi báo giá</legend>
      <p className="field-help">
        Hạng mục bắt buộc luôn đi cùng nhau. Các nhóm tùy chọn được chọn trọn nhóm.
      </p>
      <div className="public-item-list">
        {selectionUnits(quote).map((unit) => {
          const ids = unit.items.map((item) => item.id);
          const checked = unit.required || ids.every((id) => selectedOptionalIds.has(id));
          const inputId = `quote-scope-${unit.items[0]!.id}`;
          return (
            <article className="public-quote-item" key={unit.key}>
              {readOnly ? (
                <div className="public-item-label">
                  <span>
                    <strong>
                      {unit.required
                        ? unit.label
                        : unit.items.length > 1
                          ? `Nhóm ${unit.label}`
                          : unit.label}
                    </strong>
                    <small>{unit.required ? "Bắt buộc" : "Tùy chọn"}</small>
                  </span>
                  <strong>
                    {formatMoney(unit.items.reduce((sum, item) => sum + item.lineTotal, 0))}
                  </strong>
                </div>
              ) : (
                <label htmlFor={inputId}>
                  <input
                    checked={checked}
                    disabled={unit.required || disabled}
                    id={inputId}
                    onChange={(event) => onToggle(ids, event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong>
                      {unit.required
                        ? unit.label
                        : unit.items.length > 1
                          ? `Nhóm ${unit.label}`
                          : unit.label}
                    </strong>
                    <small>{unit.required ? "Bắt buộc" : "Tùy chọn"}</small>
                  </span>
                  <strong>
                    {formatMoney(unit.items.reduce((sum, item) => sum + item.lineTotal, 0))}
                  </strong>
                </label>
              )}
              {unit.items.length > 1 && (
                <ul aria-label={`Các hạng mục trong nhóm ${unit.label}`}>
                  {unit.items.map((item) => (
                    <li key={item.id}>
                      <span>{item.description}</span>
                      <span>{formatMoney(item.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {unit.items.length === 1 && (
                <p>
                  {ITEM_KIND_LABELS[unit.items[0]!.kind]} · {unit.items[0]!.quantity} ×{" "}
                  {formatMoney(unit.items[0]!.unitPrice)}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </fieldset>
  );
}

function DecisionResult({
  decision,
  decidedAt,
  approvedAmount,
  selectedItems,
}: {
  decision: QuoteDecision;
  decidedAt: string | null;
  approvedAmount?: number;
  selectedItems?: PublicQuoteItem[];
}) {
  return (
    <section className="public-decision-result" aria-live="polite" tabIndex={-1}>
      <p className="eyebrow">Quyết định đã ghi nhận</p>
      <h2>{DECISION_LABELS[decision]}</h2>
      <p>
        {decidedAt
          ? `Thời gian ghi nhận: ${formatDateTime(decidedAt)}`
          : "Thời gian ghi nhận chưa được cung cấp."}
      </p>
      {approvedAmount !== undefined && decision !== "DECLINED" && (
        <p className="public-approved-total">
          Giá trị được duyệt <strong>{formatMoney(approvedAmount)}</strong>
        </p>
      )}
      {selectedItems && decision !== "DECLINED" && (
        <div>
          <h3>Phạm vi đã xác nhận</h3>
          <ul>
            {selectedItems.map((item) => (
              <li key={item.id}>{item.description}</li>
            ))}
          </ul>
        </div>
      )}
      {decision === "PARTIALLY_ACCEPTED" && approvedAmount === undefined && (
        <p>
          Trang theo dõi chỉ hiển thị trạng thái sau khi tải lại. Hãy liên hệ cửa hàng nếu bạn cần
          đối chiếu chi tiết hạng mục và số tiền đã duyệt.
        </p>
      )}
      <p>Quyết định này là cuối cùng cho phiên bản báo giá hiện tại.</p>
    </section>
  );
}

export interface PublicQuotePortalScreenProps {
  token: string;
  api?: PublicPortalApi;
}

export function PublicQuotePortalScreen({ token, api: suppliedApi }: PublicQuotePortalScreenProps) {
  const [api] = useState<PublicPortalApi>(() => suppliedApi ?? new BrowserPublicPortalApi());
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<PublicErrorKind>("network");
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [selectedOptionalIds, setSelectedOptionalIds] = useState<Set<string>>(new Set());
  const [customerNote, setCustomerNote] = useState("");
  const [review, setReview] = useState<DecisionReview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<QuoteDecisionResult | null>(null);
  const idempotency = useRef<{ signature: string; key: string } | null>(null);
  const submittingRef = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const resultSection = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoadError("invalid");
      setLoadState("error");
      return;
    }
    setLoadState("loading");
    try {
      const nextOrder = await api.getOrder(token);
      setOrder(nextOrder);
      setSelectedOptionalIds(new Set(nextOrder.quote ? optionalIds(nextOrder.quote) : []));
      setCustomerNote("");
      setResult(null);
      setReview(null);
      setConfirmed(false);
      setSubmitError("");
      idempotency.current = null;
      setLoadState("ready");
    } catch (error) {
      setLoadError(errorKind(error));
      setLoadState("error");
    }
  }, [api, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (review) reviewHeading.current?.focus();
  }, [review]);

  useEffect(() => {
    if (result) resultSection.current?.focus();
  }, [result]);

  const quote = order?.quote ?? null;
  const selectedItems = useMemo(
    () => (quote ? selectedQuoteItems(quote, selectedOptionalIds) : []),
    [quote, selectedOptionalIds],
  );
  const previewTotal = quote ? approvedTotal(selectedItems, quote.discount) : 0;

  function updateSelection(ids: string[], checked: boolean) {
    setSelectedOptionalIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    idempotency.current = null;
    setSubmitError("");
  }

  function updateNote(value: string) {
    setCustomerNote(value);
    idempotency.current = null;
    setSubmitError("");
  }

  function openReview(decision: QuoteDecision) {
    if (!quote || quote.status !== "SENT") return;
    const approvedItemIds =
      decision === "DECLINED"
        ? []
        : optionalIds(quote)
            .filter((id) => selectedOptionalIds.has(id))
            .sort();
    const input: QuoteDecisionInput = {
      decision,
      approvedItemIds,
      customerNote: customerNote.trim() || null,
    };
    const exactItems = decision === "DECLINED" ? [] : selectedItems;
    const amount = decision === "DECLINED" ? 0 : approvedTotal(exactItems, quote.discount);
    const signature = JSON.stringify(input);
    setReview({ decision, input, selectedItems: exactItems, previewTotal: amount, signature });
    setConfirmed(false);
    setSubmitError("");
  }

  async function reloadAfterConflict() {
    try {
      const nextOrder = await api.getOrder(token);
      setOrder(nextOrder);
      setReview(null);
      setConfirmed(false);
      setSubmitError("");
      idempotency.current = null;
      setLoadState("ready");
    } catch (error) {
      setLoadError(errorKind(error));
      setLoadState("error");
    }
  }

  async function submitDecision() {
    if (!review || !confirmed || submittingRef.current) return;
    const stable =
      idempotency.current?.signature === review.signature
        ? idempotency.current
        : { signature: review.signature, key: newIdempotencyKey() };
    idempotency.current = stable;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const nextResult = await api.decideQuote(token, review.input, stable.key);
      setResult(nextResult);
      setReview(null);
      setConfirmed(false);
    } catch (error) {
      if (error instanceof RepairFlowApiError && error.code === "QUOTE_ALREADY_DECIDED") {
        await reloadAfterConflict();
      } else {
        const kind = errorKind(error);
        if (kind === "invalid" || kind === "expired" || kind === "unavailable") {
          setLoadError(kind);
          setLoadState("error");
        } else if (kind === "rate-limited") {
          setSubmitError("Bạn thao tác quá nhanh. Vui lòng chờ một lúc rồi thử lại.");
        } else if (error instanceof RepairFlowApiError && error.status === 422) {
          setSubmitError("Lựa chọn chưa hợp lệ. Hãy kiểm tra lại phạm vi báo giá rồi thử lại.");
        } else if (error instanceof RepairFlowApiError && error.code === "IDEMPOTENCY_KEY_REUSED") {
          setSubmitError("Yêu cầu xác nhận đã thay đổi. Hãy quay lại kiểm tra lựa chọn.");
        } else {
          setSubmitError("Chưa thể gửi quyết định. Dữ liệu của bạn vẫn được giữ lại để thử lại.");
        }
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (loadState === "loading") {
    return (
      <main className="public-portal-shell public-state-shell" aria-busy="true">
        <section className="public-state-card">
          <span className="spinner" aria-hidden="true" />
          <h1>Đang tải thông tin sửa chữa</h1>
          <p>Vui lòng chờ trong giây lát.</p>
        </section>
      </main>
    );
  }

  if (loadState === "error" || !order) {
    return <PublicState kind={loadError} onRetry={() => void load()} />;
  }

  const terminalDecision = quote ? decisionFromStatus(quote.status) : null;
  const allOptionalSelected = quote
    ? optionalIds(quote).every((id) => selectedOptionalIds.has(id))
    : false;
  const positiveDecision: QuoteDecision = allOptionalSelected ? "ACCEPTED" : "PARTIALLY_ACCEPTED";

  return (
    <main className="public-portal-shell">
      <header className="public-portal-header">
        <div>
          <p className="eyebrow">RepairFlow · Theo dõi sửa chữa</p>
          <h1>{order.shopName}</h1>
          {order.shopContact && <p>Liên hệ cửa hàng: {order.shopContact}</p>}
        </div>
        <span className="status-badge">{STATUS_LABELS[order.status]}</span>
      </header>

      <section className="public-order-summary" aria-labelledby="public-order-heading">
        <div>
          <p className="eyebrow">Phiếu sửa chữa</p>
          <h2 id="public-order-heading">{order.orderCode}</h2>
        </div>
        <dl>
          <div>
            <dt>Thiết bị</dt>
            <dd>{order.deviceLabel}</dd>
          </div>
          <div>
            <dt>Trạng thái</dt>
            <dd>{STATUS_LABELS[order.status]}</dd>
          </div>
        </dl>
      </section>

      {quote ? (
        <section className="public-quote-card" aria-labelledby="public-quote-heading">
          <header>
            <div>
              <p className="eyebrow">Báo giá phiên bản {quote.versionNo}</p>
              <h2 id="public-quote-heading">Chi tiết báo giá</h2>
            </div>
            <p>Hiệu lực đến {formatDateTime(quote.expiresAt)}</p>
          </header>

          {quote.customerNote && (
            <blockquote className="public-customer-note">
              <strong>Lời nhắn từ cửa hàng</strong>
              <p>{quote.customerNote}</p>
            </blockquote>
          )}

          <QuoteItems
            disabled={quote.status !== "SENT" || Boolean(review) || submitting}
            onToggle={updateSelection}
            quote={quote}
            readOnly={quote.status !== "SENT"}
            selectedOptionalIds={selectedOptionalIds}
          />

          <dl className="public-quote-totals">
            <div>
              <dt>Tạm tính toàn bộ báo giá</dt>
              <dd>{formatMoney(quote.subtotal)}</dd>
            </div>
            <div>
              <dt>Giảm giá</dt>
              <dd>− {formatMoney(quote.discount)}</dd>
            </div>
            <div>
              <dt>{quote.status === "SENT" ? "Giá trị lựa chọn" : "Tổng báo giá ban đầu"}</dt>
              <dd>{formatMoney(quote.status === "SENT" ? previewTotal : quote.total)}</dd>
            </div>
          </dl>

          {result ? (
            <section ref={resultSection} tabIndex={-1}>
              <DecisionResult
                approvedAmount={result.approvedTotal}
                decidedAt={result.decidedAt}
                decision={result.decision}
                selectedItems={result.decision === "DECLINED" ? [] : selectedItems}
              />
            </section>
          ) : terminalDecision ? (
            <DecisionResult decidedAt={quote.decidedAt} decision={terminalDecision} />
          ) : review ? (
            <section className="public-decision-review" aria-labelledby="decision-review-heading">
              <p className="eyebrow">Xác nhận cuối cùng</p>
              <h2 id="decision-review-heading" ref={reviewHeading} tabIndex={-1}>
                {review.decision === "DECLINED"
                  ? "Xác nhận từ chối báo giá"
                  : "Kiểm tra phạm vi đồng ý"}
              </h2>
              {review.decision !== "DECLINED" && (
                <>
                  <ul>
                    {review.selectedItems.map((item) => (
                      <li key={item.id}>
                        <span>{item.description}</span>
                        <strong>{formatMoney(item.lineTotal)}</strong>
                      </li>
                    ))}
                  </ul>
                  <p className="public-approved-total">
                    Tổng dự kiến <strong>{formatMoney(review.previewTotal)}</strong>
                  </p>
                </>
              )}
              <p>
                Quyết định này sẽ được ghi nhận cho báo giá phiên bản {quote.versionNo} và không thể
                sửa trực tiếp sau khi gửi.
              </p>
              {review.input.customerNote && (
                <div className="public-review-note">
                  <strong>Lời nhắn cho cửa hàng</strong>
                  <p>{review.input.customerNote}</p>
                </div>
              )}
              <label className="public-confirm-check">
                <input
                  checked={confirmed}
                  disabled={submitting}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  type="checkbox"
                />
                <span>Tôi đã kiểm tra và xác nhận quyết định trên.</span>
              </label>
              {submitError && (
                <p className="notice notice-error" role="alert">
                  {submitError}
                </p>
              )}
              <div className="public-decision-actions">
                <button
                  className="button button-secondary"
                  disabled={submitting}
                  onClick={() => {
                    setReview(null);
                    setConfirmed(false);
                    setSubmitError("");
                    idempotency.current = null;
                  }}
                  type="button"
                >
                  Quay lại chỉnh sửa
                </button>
                <button
                  className="button button-primary"
                  disabled={!confirmed || submitting}
                  onClick={() => void submitDecision()}
                  type="button"
                >
                  {submitting ? "Đang ghi nhận…" : "Xác nhận quyết định"}
                </button>
              </div>
            </section>
          ) : (
            <section className="public-decision-form" aria-labelledby="public-decision-heading">
              <h2 id="public-decision-heading">Quyết định của khách hàng</h2>
              <label className="field" htmlFor="public-customer-note">
                <span>Lời nhắn cho cửa hàng (không bắt buộc)</span>
                <textarea
                  id="public-customer-note"
                  maxLength={2000}
                  onChange={(event) => updateNote(event.target.value)}
                  rows={4}
                  value={customerNote}
                />
              </label>
              <div className="public-decision-actions">
                <button
                  className="button button-secondary"
                  onClick={() => openReview("DECLINED")}
                  type="button"
                >
                  Từ chối báo giá
                </button>
                <button
                  className="button button-primary"
                  onClick={() => openReview(positiveDecision)}
                  type="button"
                >
                  {positiveDecision === "ACCEPTED"
                    ? "Tiếp tục đồng ý toàn bộ"
                    : "Tiếp tục đồng ý một phần"}
                </button>
              </div>
            </section>
          )}
        </section>
      ) : (
        <section className="public-empty-quote">
          <p className="eyebrow">Theo dõi tiến độ</p>
          <h2>Chưa có báo giá cần xác nhận</h2>
          <p>
            Cửa hàng chưa gửi báo giá qua liên kết này. Bạn vẫn có thể theo dõi các cập nhật bên
            dưới.
          </p>
        </section>
      )}

      <section className="public-timeline" aria-labelledby="public-timeline-heading">
        <header>
          <p className="eyebrow">Cập nhật từ cửa hàng</p>
          <h2 id="public-timeline-heading">Tiến độ sửa chữa</h2>
        </header>
        {order.timeline.length ? (
          <ol>
            {order.timeline.map((event, index) => (
              <li key={`${event.createdAt}-${event.type}-${index}`}>
                <span className="timeline-dot" aria-hidden="true" />
                <div>
                  <p>{event.message}</p>
                  <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty-copy">Chưa có cập nhật công khai.</p>
        )}
      </section>
    </main>
  );
}

export function PublicQuotePortal() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  return <PublicQuotePortalScreen token={token} />;
}
