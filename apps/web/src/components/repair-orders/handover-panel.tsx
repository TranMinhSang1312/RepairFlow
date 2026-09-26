"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RepairFlowApiError } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi, UploadProgress } from "@/lib/api/intake-api";
import type {
  CompleteHandoverInput,
  CreatePaymentInput,
  Membership,
  PaymentDisposition,
  PaymentMethod,
  RepairOrderDetail,
} from "@/lib/api/types";

interface HandoverPanelProps {
  api: RepairOrderWorkspaceApi;
  membership: Membership;
  order: RepairOrderDetail;
  shopId: string;
  onReload(): Promise<void>;
}

type PreparedCommand = { fingerprint: string; key: string };
type FieldErrors = Record<string, string>;

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Tiền mặt" },
  { value: "BANK_TRANSFER", label: "Chuyển khoản" },
  { value: "CARD", label: "Thẻ" },
  { value: "E_WALLET", label: "Ví điện tử" },
  { value: "OTHER", label: "Khác" },
];

const DISPOSITIONS: Array<{ value: PaymentDisposition; label: string }> = [
  { value: "PAID", label: "Đã thanh toán đủ" },
  { value: "PARTIALLY_PAID", label: "Thanh toán một phần" },
  { value: "WAIVED", label: "Miễn phần còn lại" },
  { value: "PAY_LATER", label: "Thanh toán sau" },
];

const OUTCOME_LABELS = {
  REPAIRED: "Đã sửa chữa",
  DECLINED_QUOTE: "Khách từ chối báo giá",
  UNREPAIRABLE: "Không thể sửa",
  NO_FAULT_FOUND: "Không phát hiện lỗi",
  CUSTOMER_CANCELLED: "Khách hủy yêu cầu",
} as const;

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 15_000_000;

function randomKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random}`;
}

function commandKey(current: PreparedCommand | undefined, prefix: string, payload: unknown) {
  const fingerprint = JSON.stringify(payload);
  return current?.fingerprint === fingerprint ? current : { fingerprint, key: randomKey(prefix) };
}

function money(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function dateTime(value: string | null): string {
  if (!value) return "Chưa có";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Không xác định" : date.toLocaleString("vi-VN");
}

function parseMoney(value: string): number | null {
  if (!/^\d+$/u.test(value.trim())) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function HandoverPanel({ api, membership, order, shopId, onReload }: HandoverPanelProps) {
  const summary = order.paymentSummary ?? { approvedTotal: 0, paidTotal: 0, amountDue: 0 };
  const payments = order.payments ?? [];
  const canMutate = membership.role === "OWNER" || membership.role === "RECEPTIONIST";
  const canAddPayment =
    canMutate &&
    summary.amountDue > 0 &&
    (order.status === "READY_FOR_PICKUP" ||
      (order.status === "COMPLETED" &&
        (order.handover?.paymentDisposition === "PARTIALLY_PAID" ||
          order.handover?.paymentDisposition === "PAY_LATER")));
  const canComplete = canMutate && order.status === "READY_FOR_PICKUP" && !order.handover;
  const repaired = order.completionOutcome === "REPAIRED";

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);

  const [recipientName, setRecipientName] = useState("");
  const [disposition, setDisposition] = useState<PaymentDisposition>("PAID");
  const [paymentNote, setPaymentNote] = useState("");
  const [finalPaymentAmount, setFinalPaymentAmount] = useState("");
  const [finalPaymentMethod, setFinalPaymentMethod] = useState<PaymentMethod>("CASH");
  const [finalPaymentReference, setFinalPaymentReference] = useState("");
  const [warrantyEndsAt, setWarrantyEndsAt] = useState("");
  const [warrantyTerms, setWarrantyTerms] = useState("");
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [signatureId, setSignatureId] = useState<string | null>(null);
  const [signatureState, setSignatureState] = useState<UploadProgress["stage"] | "error" | "">("");
  const [signatureError, setSignatureError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [handoverError, setHandoverError] = useState("");
  const [handoverMessage, setHandoverMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [tracking, setTracking] = useState<{ url: string; expiresAt: string } | null>(null);
  const [trackingExpired, setTrackingExpired] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  const paymentCommand = useRef<PreparedCommand | undefined>(undefined);
  const handoverCommand = useRef<PreparedCommand | undefined>(undefined);
  const paymentBusyRef = useRef(false);
  const handoverBusyRef = useRef(false);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeReview = useCallback(() => {
    if (!handoverBusyRef.current) setReviewOpen(false);
  }, []);

  useEffect(() => {
    if (!reviewOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = focusableElements(dialog);
    (items[0] ?? dialog).focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeReview();
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = focusableElements(dialog);
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
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      reviewButtonRef.current?.focus();
    };
  }, [closeReview, reviewOpen]);

  function resetPaymentCommand() {
    paymentCommand.current = undefined;
    setPaymentError("");
    setPaymentMessage("");
  }

  function resetHandoverCommand() {
    handoverCommand.current = undefined;
    setReviewRequired(false);
    setHandoverError("");
    setHandoverMessage("");
  }

  async function submitPayment() {
    if (!canAddPayment || paymentBusyRef.current) return;
    const amount = parseMoney(paymentAmount);
    if (!amount || amount > summary.amountDue) {
      setPaymentError(
        `Số tiền phải là số nguyên dương và không vượt quá ${money(summary.amountDue)}.`,
      );
      return;
    }
    const input: CreatePaymentInput = {
      amount,
      method: paymentMethod,
      reference: paymentReference.trim() || null,
    };
    const command = commandKey(paymentCommand.current, "payment", input);
    paymentCommand.current = command;
    paymentBusyRef.current = true;
    setPaymentBusy(true);
    setPaymentError("");
    setPaymentMessage("");
    try {
      await api.createPayment(shopId, order.id, input, command.key);
      setPaymentAmount("");
      setPaymentReference("");
      paymentCommand.current = undefined;
      setPaymentMessage("Đã ghi nhận biên nhận thanh toán mới.");
      await onReload();
    } catch (error) {
      if (error instanceof RepairFlowApiError && error.code === "IDEMPOTENCY_KEY_REUSED") {
        paymentCommand.current = undefined;
        setPaymentError("Nội dung yêu cầu đã thay đổi. Hãy kiểm tra lại trước khi gửi.");
      } else if (error instanceof RepairFlowApiError && error.status === 409) {
        await onReload();
        setPaymentError(
          "Phiếu vừa thay đổi. Đã tải lại số dư; dữ liệu nhập vẫn được giữ để kiểm tra.",
        );
      } else {
        setPaymentError("Chưa thể ghi nhận thanh toán. Dữ liệu vẫn được giữ để thử lại.");
      }
    } finally {
      paymentBusyRef.current = false;
      setPaymentBusy(false);
    }
  }

  function finalPayment(): CreatePaymentInput | null {
    const amount = parseMoney(finalPaymentAmount);
    if (!amount) return null;
    return {
      amount,
      method: finalPaymentMethod,
      reference: finalPaymentReference.trim() || null,
    };
  }

  function buildHandoverInput(): CompleteHandoverInput | null {
    const errors: FieldErrors = {};
    const recipient = recipientName.trim();
    if (!recipient) errors.recipientName = "Vui lòng nhập người nhận thiết bị.";
    if (recipient.length > 150) errors.recipientName = "Tên người nhận tối đa 150 ký tự.";
    if (paymentNote.trim().length > 1000) errors.paymentNote = "Ghi chú tối đa 1.000 ký tự.";
    const payment = finalPayment();
    if (finalPaymentAmount.trim() && !payment) {
      errors.finalPaymentAmount = "Số tiền phải là số nguyên dương.";
    }
    if (payment && payment.amount > summary.amountDue) {
      errors.finalPaymentAmount = "Số tiền cuối không được vượt quá số còn phải thu.";
    }
    const finalDue = summary.amountDue - (payment?.amount ?? 0);
    const finalPaid = summary.paidTotal + (payment?.amount ?? 0);
    if (disposition === "PAID" && finalDue !== 0) {
      errors.finalPaymentAmount = "Trạng thái đã thanh toán đủ yêu cầu số còn phải thu bằng 0.";
    }
    if (disposition === "PARTIALLY_PAID" && (finalPaid <= 0 || finalDue <= 0)) {
      errors.finalPaymentAmount =
        "Thanh toán một phần phải có số đã trả và số còn nợ đều lớn hơn 0.";
    }
    if ((disposition === "PAY_LATER" || disposition === "WAIVED") && finalDue <= 0) {
      errors.finalPaymentAmount = "Cách xử lý này chỉ hợp lệ khi số còn lại lớn hơn 0.";
    }
    if (
      (disposition === "PARTIALLY_PAID" ||
        disposition === "PAY_LATER" ||
        disposition === "WAIVED") &&
      finalDue > 0 &&
      !paymentNote.trim()
    ) {
      errors.paymentNote = "Vui lòng ghi rõ lý do hoặc thỏa thuận cho số dư còn lại.";
    }
    let warranty: CompleteHandoverInput["warranty"] = null;
    if (repaired) {
      const end = new Date(warrantyEndsAt);
      if (!warrantyEndsAt || Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
        errors.warrantyEndsAt = "Thời hạn bảo hành phải sau thời điểm bàn giao.";
      }
      if (!warrantyTerms.trim()) errors.warrantyTerms = "Vui lòng nhập điều khoản bảo hành.";
      if (warrantyTerms.trim().length > 10_000) {
        errors.warrantyTerms = "Điều khoản bảo hành tối đa 10.000 ký tự.";
      }
      if (!errors.warrantyEndsAt && !errors.warrantyTerms) {
        warranty = { endsAt: end.toISOString(), terms: warrantyTerms.trim() };
      }
    }
    if (signatureState && signatureState !== "complete") {
      errors.signature = "Bằng chứng chữ ký chưa tải lên hoàn tất.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return null;
    return {
      recipientName: recipient,
      paymentDisposition: disposition,
      paymentNote: paymentNote.trim() || null,
      signatureMediaAssetId: signatureId,
      expectedLockVersion: order.lockVersion,
      payment,
      warranty,
    };
  }

  function openReview() {
    if (!canComplete) return;
    const input = buildHandoverInput();
    if (!input) return;
    const command = commandKey(handoverCommand.current, "handover", input);
    handoverCommand.current = command;
    setReviewRequired(false);
    setReviewOpen(true);
  }

  async function submitHandover() {
    if (handoverBusyRef.current) return;
    const input = buildHandoverInput();
    const command = handoverCommand.current;
    if (!input || !command || command.fingerprint !== JSON.stringify(input)) {
      setReviewOpen(false);
      setReviewRequired(true);
      setHandoverError("Nội dung đã thay đổi. Hãy kiểm tra và mở xác nhận lại.");
      return;
    }
    handoverBusyRef.current = true;
    setHandoverBusy(true);
    setHandoverError("");
    try {
      const result = await api.completeHandover(shopId, order.id, input, command.key);
      setTracking({ url: result.trackingUrl, expiresAt: result.trackingExpiresAt });
      setTrackingExpired(false);
      setReviewOpen(false);
      setHandoverMessage("Bàn giao đã hoàn tất và phiếu đã chuyển sang trạng thái kết thúc.");
      await onReload();
    } catch (error) {
      if (error instanceof RepairFlowApiError && error.code === "TOKEN_EXPIRED") {
        setTracking(null);
        setTrackingExpired(true);
        setReviewOpen(false);
        setHandoverMessage("Bàn giao đã hoàn tất nhưng liên kết theo dõi cố định đã hết hạn.");
        await onReload();
      } else if (error instanceof RepairFlowApiError && error.code === "IDEMPOTENCY_KEY_REUSED") {
        handoverCommand.current = undefined;
        setReviewOpen(false);
        setReviewRequired(true);
        setHandoverError("Nội dung khác với lần gửi trước. Hãy kiểm tra và xác nhận lại.");
      } else if (error instanceof RepairFlowApiError && error.status === 409) {
        setReviewOpen(false);
        setReviewRequired(true);
        setHandoverError("Phiếu vừa thay đổi. Đã tải lại dữ liệu; hãy kiểm tra và xác nhận lại.");
        await onReload();
      } else {
        setHandoverError("Chưa thể hoàn tất bàn giao. Dữ liệu vẫn được giữ để thử lại.");
      }
    } finally {
      handoverBusyRef.current = false;
      setHandoverBusy(false);
    }
  }

  async function uploadSignature(file: File) {
    setSignatureError("");
    setSignatureId(null);
    setSignatureFile(file);
    resetHandoverCommand();
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setSignatureState("error");
      setSignatureError("Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.");
      return;
    }
    if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
      setSignatureState("error");
      setSignatureError("Ảnh phải nhỏ hơn hoặc bằng 15 MB.");
      return;
    }
    try {
      const mediaId = await api.uploadHandoverEvidence(shopId, order.id, file, (progress) =>
        setSignatureState(progress.stage),
      );
      setSignatureId(mediaId);
      setSignatureState("complete");
    } catch {
      setSignatureState("error");
      setSignatureError("Không thể tải bằng chứng. Hãy thử lại.");
    }
  }

  async function copyTrackingLink() {
    if (!tracking || new Date(tracking.expiresAt).getTime() <= Date.now()) {
      setTracking(null);
      setTrackingExpired(true);
      setCopyMessage("Liên kết đã hết hạn và không thể sao chép.");
      return;
    }
    try {
      await navigator.clipboard.writeText(tracking.url);
      setCopyMessage("Đã sao chép liên kết theo dõi.");
    } catch {
      setCopyMessage("Trình duyệt không cho phép sao chép. Hãy thử lại.");
    }
  }

  const sortedPayments = useMemo(
    () => [...payments].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt)),
    [payments],
  );

  return (
    <div className="handover-panel">
      <section className="handover-summary-grid" aria-label="Tổng hợp thanh toán">
        <article className="workspace-card money-card">
          <span>Kết quả sửa chữa</span>
          <strong>
            {order.completionOutcome ? OUTCOME_LABELS[order.completionOutcome] : "Chưa ghi nhận"}
          </strong>
        </article>
        <article className="workspace-card money-card">
          <span>Giá trị được duyệt</span>
          <strong>{money(summary.approvedTotal)}</strong>
        </article>
        <article className="workspace-card money-card">
          <span>Đã thanh toán</span>
          <strong>{money(summary.paidTotal)}</strong>
        </article>
        <article className="workspace-card money-card money-card-due">
          <span>Còn phải thu</span>
          <strong>{money(summary.amountDue)}</strong>
        </article>
      </section>

      <section className="workspace-card handover-history-card">
        <header>
          <p className="eyebrow">Biên nhận bất biến</p>
          <h2>Lịch sử thanh toán</h2>
        </header>
        {sortedPayments.length ? (
          <ol className="payment-list">
            {sortedPayments.map((payment) => (
              <li key={payment.id}>
                <div>
                  <strong>{money(payment.amount)}</strong>
                  <span>
                    {PAYMENT_METHODS.find((item) => item.value === payment.method)?.label}
                  </span>
                </div>
                <div>
                  <span>{payment.reference || "Không có mã tham chiếu"}</span>
                  <time dateTime={payment.receivedAt}>{dateTime(payment.receivedAt)}</time>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty-copy">Chưa có biên nhận thanh toán.</p>
        )}
      </section>

      {canAddPayment && (
        <section className="workspace-card handover-form-card">
          <header>
            <p className="eyebrow">Ghi nhận thêm</p>
            <h2>Thêm thanh toán</h2>
            <p>Số dư hiển thị luôn được tải lại từ máy chủ sau khi ghi nhận.</p>
          </header>
          <div className="handover-form-grid">
            <label className="field">
              <span>Số tiền (VND)</span>
              <input
                aria-describedby={paymentError ? "payment-form-error" : undefined}
                inputMode="numeric"
                min="1"
                onChange={(event) => {
                  setPaymentAmount(event.target.value);
                  resetPaymentCommand();
                }}
                value={paymentAmount}
              />
            </label>
            <label className="field">
              <span>Phương thức</span>
              <select
                onChange={(event) => {
                  setPaymentMethod(event.target.value as PaymentMethod);
                  resetPaymentCommand();
                }}
                value={paymentMethod}
              >
                {PAYMENT_METHODS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field handover-wide-field">
              <span>Mã tham chiếu (không bắt buộc)</span>
              <input
                maxLength={200}
                onChange={(event) => {
                  setPaymentReference(event.target.value);
                  resetPaymentCommand();
                }}
                value={paymentReference}
              />
            </label>
          </div>
          {paymentError && (
            <p className="notice notice-error" id="payment-form-error" role="alert">
              {paymentError}
            </p>
          )}
          {paymentMessage && (
            <p className="notice notice-success" role="status">
              {paymentMessage}
            </p>
          )}
          <button
            className="button button-primary"
            disabled={paymentBusy}
            onClick={() => void submitPayment()}
            type="button"
          >
            {paymentBusy ? "Đang ghi nhận…" : "Ghi nhận thanh toán"}
          </button>
        </section>
      )}

      {!canAddPayment && !canComplete && !order.handover && (
        <section className="workspace-card">
          <h2>Chưa thể bàn giao</h2>
          <p className="empty-copy">
            Thanh toán và bàn giao chỉ khả dụng khi phiếu đã sẵn sàng trả máy và tài khoản có đúng
            quyền.
          </p>
        </section>
      )}

      {order.handover || handoverMessage ? (
        <section className="workspace-card handover-terminal-card" aria-live="polite">
          <header>
            <p className="eyebrow">Bàn giao bất biến</p>
            <h2>Thiết bị đã rời cửa hàng</h2>
          </header>
          {order.handover && (
            <dl className="handover-facts">
              <div>
                <dt>Người nhận</dt>
                <dd>{order.handover.recipientName}</dd>
              </div>
              <div>
                <dt>Thời điểm</dt>
                <dd>{dateTime(order.handover.handedOverAt)}</dd>
              </div>
              <div>
                <dt>Thanh toán</dt>
                <dd>{order.handover.paymentDisposition}</dd>
              </div>
              <div>
                <dt>Ghi chú</dt>
                <dd>{order.handover.paymentNote ?? "Không có"}</dd>
              </div>
            </dl>
          )}
          {order.warranty && (
            <div className="warranty-readonly">
              <h3>Bảo hành đã ghi nhận</h3>
              <p>
                {dateTime(order.warranty.startsAt)} – {dateTime(order.warranty.endsAt)}
              </p>
              <p>{order.warranty.terms}</p>
            </div>
          )}
          {handoverMessage && <p className="notice notice-success">{handoverMessage}</p>}
          {tracking && !trackingExpired && (
            <div className="tracking-boundary">
              <div>
                <strong>Liên kết theo dõi dành cho khách hàng</strong>
                <small>
                  Khả dụng đến {dateTime(tracking.expiresAt)}. URL không được hiển thị trên màn
                  hình.
                </small>
              </div>
              <button
                className="button button-primary"
                onClick={() => void copyTrackingLink()}
                type="button"
              >
                Sao chép liên kết
              </button>
            </div>
          )}
          {trackingExpired && (
            <p className="notice notice-info">
              Liên kết theo dõi cố định đã hết hạn. Bàn giao vẫn được ghi nhận và không được gửi lại
              để tạo token mới.
            </p>
          )}
          {copyMessage && <p role="status">{copyMessage}</p>}
        </section>
      ) : canComplete ? (
        <section className="workspace-card handover-form-card">
          <header>
            <p className="eyebrow">Kết thúc lưu giữ thiết bị</p>
            <h2>Xác nhận bàn giao</h2>
            <p>Thao tác này tạo lịch sử ràng buộc và chuyển phiếu sang trạng thái hoàn tất.</p>
          </header>
          <div className="handover-form-grid">
            <label className="field handover-wide-field">
              <span>Người nhận thiết bị</span>
              <input
                aria-describedby={
                  fieldErrors.recipientName ? "handover-recipient-error" : undefined
                }
                aria-invalid={Boolean(fieldErrors.recipientName)}
                maxLength={150}
                onChange={(event) => {
                  setRecipientName(event.target.value);
                  resetHandoverCommand();
                }}
                value={recipientName}
              />
              {fieldErrors.recipientName && (
                <small className="field-error" id="handover-recipient-error">
                  {fieldErrors.recipientName}
                </small>
              )}
            </label>
            <label className="field">
              <span>Xử lý thanh toán</span>
              <select
                onChange={(event) => {
                  setDisposition(event.target.value as PaymentDisposition);
                  resetHandoverCommand();
                }}
                value={disposition}
              >
                {DISPOSITIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Thanh toán cuối (VND, nếu có)</span>
              <input
                aria-describedby={
                  fieldErrors.finalPaymentAmount ? "handover-final-payment-error" : undefined
                }
                aria-invalid={Boolean(fieldErrors.finalPaymentAmount)}
                inputMode="numeric"
                onChange={(event) => {
                  setFinalPaymentAmount(event.target.value);
                  resetHandoverCommand();
                }}
                value={finalPaymentAmount}
              />
              {fieldErrors.finalPaymentAmount && (
                <small className="field-error" id="handover-final-payment-error">
                  {fieldErrors.finalPaymentAmount}
                </small>
              )}
            </label>
            {finalPaymentAmount.trim() && (
              <>
                <label className="field">
                  <span>Phương thức thanh toán cuối</span>
                  <select
                    onChange={(event) => {
                      setFinalPaymentMethod(event.target.value as PaymentMethod);
                      resetHandoverCommand();
                    }}
                    value={finalPaymentMethod}
                  >
                    {PAYMENT_METHODS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Mã tham chiếu</span>
                  <input
                    maxLength={200}
                    onChange={(event) => {
                      setFinalPaymentReference(event.target.value);
                      resetHandoverCommand();
                    }}
                    value={finalPaymentReference}
                  />
                </label>
              </>
            )}
            <label className="field handover-wide-field">
              <span>Ghi chú thanh toán</span>
              <textarea
                aria-describedby={fieldErrors.paymentNote ? "handover-note-error" : undefined}
                aria-invalid={Boolean(fieldErrors.paymentNote)}
                maxLength={1000}
                onChange={(event) => {
                  setPaymentNote(event.target.value);
                  resetHandoverCommand();
                }}
                rows={3}
                value={paymentNote}
              />
              {fieldErrors.paymentNote && (
                <small className="field-error" id="handover-note-error">
                  {fieldErrors.paymentNote}
                </small>
              )}
            </label>
            {repaired && (
              <>
                <label className="field">
                  <span>Bảo hành đến</span>
                  <input
                    aria-describedby={
                      fieldErrors.warrantyEndsAt ? "handover-warranty-end-error" : undefined
                    }
                    aria-invalid={Boolean(fieldErrors.warrantyEndsAt)}
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={(event) => {
                      setWarrantyEndsAt(event.target.value);
                      resetHandoverCommand();
                    }}
                    type="datetime-local"
                    value={warrantyEndsAt}
                  />
                  {fieldErrors.warrantyEndsAt && (
                    <small className="field-error" id="handover-warranty-end-error">
                      {fieldErrors.warrantyEndsAt}
                    </small>
                  )}
                </label>
                <label className="field handover-wide-field">
                  <span>Điều khoản bảo hành</span>
                  <textarea
                    aria-describedby={
                      fieldErrors.warrantyTerms ? "handover-warranty-terms-error" : undefined
                    }
                    aria-invalid={Boolean(fieldErrors.warrantyTerms)}
                    maxLength={10000}
                    onChange={(event) => {
                      setWarrantyTerms(event.target.value);
                      resetHandoverCommand();
                    }}
                    rows={4}
                    value={warrantyTerms}
                  />
                  {fieldErrors.warrantyTerms && (
                    <small className="field-error" id="handover-warranty-terms-error">
                      {fieldErrors.warrantyTerms}
                    </small>
                  )}
                </label>
              </>
            )}
            <label className="field handover-wide-field">
              <span>Ảnh chữ ký/bàn giao (không bắt buộc)</span>
              <input
                accept="image/jpeg,image/png,image/webp"
                aria-describedby={
                  signatureError || fieldErrors.signature ? "handover-signature-error" : undefined
                }
                aria-invalid={Boolean(signatureError || fieldErrors.signature)}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadSignature(file);
                }}
                type="file"
              />
              {signatureFile && (
                <small>
                  {signatureFile.name} · {signatureState || "Đang chờ"}
                </small>
              )}
              {(signatureError || fieldErrors.signature) && (
                <small className="field-error" id="handover-signature-error">
                  {signatureError || fieldErrors.signature}
                </small>
              )}
            </label>
          </div>
          {reviewRequired && (
            <p className="notice notice-info">
              Dữ liệu máy chủ đã thay đổi. Hãy rà soát lại trước khi xác nhận.
            </p>
          )}
          {handoverError && (
            <p className="notice notice-error" role="alert">
              {handoverError}
            </p>
          )}
          <button
            className="button button-primary"
            disabled={
              handoverBusy || signatureState === "uploading" || signatureState === "presigning"
            }
            onClick={openReview}
            ref={reviewButtonRef}
            type="button"
          >
            Kiểm tra và bàn giao
          </button>
        </section>
      ) : null}

      {reviewOpen && (
        <div className="handover-dialog-backdrop" role="presentation">
          <div
            aria-labelledby="handover-dialog-title"
            aria-modal="true"
            className="handover-dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <p className="eyebrow">Xác nhận ràng buộc</p>
            <h2 id="handover-dialog-title">Kết thúc lưu giữ thiết bị?</h2>
            <p>
              Thiết bị sẽ được ghi nhận đã rời cửa hàng, phiếu trở thành terminal và các liên kết
              quyết định cũ bị thu hồi. Payment, handover và warranty không thể chỉnh sửa.
            </p>
            <dl className="handover-facts">
              <div>
                <dt>Người nhận</dt>
                <dd>{recipientName.trim()}</dd>
              </div>
              <div>
                <dt>Xử lý thanh toán</dt>
                <dd>{disposition}</dd>
              </div>
              <div>
                <dt>Số còn lại dự kiến</dt>
                <dd>{money(summary.amountDue - (finalPayment()?.amount ?? 0))}</dd>
              </div>
            </dl>
            {handoverError && (
              <p className="notice notice-error" role="alert">
                {handoverError}
              </p>
            )}
            <div className="handover-dialog-actions">
              <button
                className="button button-secondary"
                disabled={handoverBusy}
                onClick={closeReview}
                type="button"
              >
                Quay lại
              </button>
              <button
                className="button button-primary"
                disabled={handoverBusy}
                onClick={() => void submitHandover()}
                type="button"
              >
                {handoverBusy ? "Đang hoàn tất…" : "Xác nhận bàn giao"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
