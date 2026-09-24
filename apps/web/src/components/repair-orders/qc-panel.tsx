"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RepairFlowApiError, safeErrorMessage } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi, UploadProgress } from "@/lib/api/intake-api";
import type {
  CreateQcRunInput,
  Membership,
  QcItemResult,
  QcRun,
  QcTemplate,
  QcTemplateItem,
  RepairOrderDetail,
} from "@/lib/api/types";

interface QcPanelProps {
  api: RepairOrderWorkspaceApi;
  membership: Membership;
  order: RepairOrderDetail;
  shopId: string;
  userId: string;
  onOrderChange(order: RepairOrderDetail): void;
  onReload(): Promise<void>;
}

interface EvidenceDraft {
  localId: string;
  file: File;
  state: "presigning" | "uploading" | "complete" | "error";
  mediaAssetId?: string | undefined;
  error?: string | undefined;
  retryable: boolean;
}

interface AnswerDraft {
  result: QcItemResult | "";
  note: string;
  evidence: EvidenceDraft[];
}

type PreparedCommand = { fingerprint: string; key: string };

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 15_000_000;

const RESULT_LABELS: Readonly<Record<QcItemResult, string>> = {
  PASS: "Đạt",
  FAIL: "Không đạt",
  NOT_APPLICABLE: "Không áp dụng",
};

function randomKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random}`;
}

function commandKey(current: PreparedCommand | undefined, prefix: string, payload: unknown) {
  const fingerprint = JSON.stringify(payload);
  if (current?.fingerprint === fingerprint) return current;
  return { fingerprint, key: randomKey(prefix) };
}

function emptyAnswers(template: QcTemplate | undefined): Record<string, AnswerDraft> {
  return Object.fromEntries(
    (template?.items ?? []).map((item) => [
      item.id,
      { result: "", note: "", evidence: [] } satisfies AnswerDraft,
    ]),
  );
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Không xác định" : date.toLocaleString("vi-VN");
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function maxRunNo(runs: QcRun[]): number {
  return runs.reduce((latest, run) => Math.max(latest, run.runNo), 0);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

function useDialogFocus(
  open: boolean,
  dialogRef: React.RefObject<HTMLDivElement | null>,
  returnFocusRef: React.RefObject<HTMLButtonElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = focusableElements(dialog);
    (focusable[0] ?? dialog).focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = dialog ? focusableElements(dialog) : [];
      if (!items.length) return;
      const first = items[0]!;
      const last = items.at(-1)!;
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
      returnFocusRef.current?.focus();
    };
  }, [dialogRef, onClose, open, returnFocusRef]);
}

function itemResults(item: QcTemplateItem): QcItemResult[] {
  return item.allowNa ? ["PASS", "FAIL", "NOT_APPLICABLE"] : ["PASS", "FAIL"];
}

function uploadStateLabel(progress: UploadProgress["stage"]): string {
  if (progress === "presigning") return "Đang chuẩn bị";
  if (progress === "uploading") return "Đang tải lên";
  return "Đã tải lên";
}

export function QcPanel({
  api,
  membership,
  order,
  shopId,
  userId,
  onOrderChange,
  onReload,
}: QcPanelProps) {
  const [templates, setTemplates] = useState<QcTemplate[]>([]);
  const [templateState, setTemplateState] = useState<"loading" | "success" | "error">("loading");
  const [templateError, setTemplateError] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
  const [failureNotes, setFailureNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"" | "submit" | "ready">("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const feedbackRef = useRef<HTMLParagraphElement | null>(null);
  const reviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const submitCommand = useRef<PreparedCommand | undefined>(undefined);
  const readyCommand = useRef<PreparedCommand | undefined>(undefined);

  const closeReview = useCallback(() => {
    if (!busyRef.current) setReviewOpen(false);
  }, []);
  useDialogFocus(reviewOpen, dialogRef, reviewButtonRef, closeReview);

  const loadTemplates = useCallback(async () => {
    setTemplateState("loading");
    setTemplateError("");
    try {
      const next = await api.listQcTemplates(shopId, false);
      const active = next
        .filter((template) => template.isActive)
        .map((template) => ({
          ...template,
          items: [...template.items].sort(
            (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
          ),
        }));
      setTemplates(active);
      setSelectedTemplateId((current) =>
        active.some((template) => template.id === current) ? current : (active[0]?.id ?? ""),
      );
      setTemplateState("success");
    } catch (reason) {
      setTemplateError(safeErrorMessage(reason));
      setTemplateState("error");
    }
  }, [api, shopId]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  useEffect(() => {
    if (!selectedTemplate) {
      setAnswers({});
      return;
    }
    setAnswers((current) =>
      Object.fromEntries(
        selectedTemplate.items.map((item) => [
          item.id,
          current[item.id] ?? ({ result: "", note: "", evidence: [] } satisfies AnswerDraft),
        ]),
      ),
    );
  }, [selectedTemplate]);

  const history = useMemo(
    () => [...order.qcRuns].sort((left, right) => left.runNo - right.runNo),
    [order.qcRuns],
  );
  const latestRunNo = maxRunNo(history);
  const latestRun = history.find((run) => run.runNo === latestRunNo);
  const isAssigned = order.assignedTechnicianUserId === userId;
  const canSubmit = membership.role === "OWNER" || (membership.role === "TECHNICIAN" && isAssigned);
  const canReady =
    membership.role === "OWNER" ||
    membership.role === "RECEPTIONIST" ||
    (membership.role === "TECHNICIAN" && isAssigned);
  const showReady =
    canReady &&
    order.status === "QUALITY_CHECK" &&
    latestRun?.result === "PASS" &&
    latestRun.runNo === latestRunNo;
  const previewResult = selectedTemplate?.items.some((item) => answers[item.id]?.result === "FAIL")
    ? "FAIL"
    : "PASS";

  function focusFeedback() {
    globalThis.setTimeout(() => feedbackRef.current?.focus(), 0);
  }

  function changeTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    setAnswers(emptyAnswers(templates.find((template) => template.id === templateId)));
    setFailureNotes("");
    setFieldErrors({});
    setReviewRequired(false);
    submitCommand.current = undefined;
  }

  function updateAnswer(itemId: string, patch: Partial<AnswerDraft>) {
    setAnswers((current) => ({
      ...current,
      [itemId]: { ...current[itemId]!, ...patch },
    }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`result:${itemId}`];
      return next;
    });
  }

  function replaceEvidence(itemId: string, localId: string, patch: Partial<EvidenceDraft>) {
    setAnswers((current) => {
      const answer = current[itemId];
      if (!answer) return current;
      return {
        ...current,
        [itemId]: {
          ...answer,
          evidence: answer.evidence.map((entry) =>
            entry.localId === localId ? { ...entry, ...patch } : entry,
          ),
        },
      };
    });
  }

  async function startUpload(itemId: string, draft: EvidenceDraft) {
    replaceEvidence(itemId, draft.localId, {
      state: "presigning",
      error: undefined,
      mediaAssetId: undefined,
      retryable: true,
    });
    try {
      const mediaAssetId = await api.uploadQcEvidence(shopId, order.id, draft.file, (progress) => {
        replaceEvidence(itemId, draft.localId, {
          state: progress.stage,
          error: uploadStateLabel(progress.stage),
        });
      });
      replaceEvidence(itemId, draft.localId, {
        state: "complete",
        mediaAssetId,
        error: undefined,
        retryable: false,
      });
    } catch (reason) {
      replaceEvidence(itemId, draft.localId, {
        state: "error",
        error: safeErrorMessage(reason),
        retryable: true,
      });
    }
  }

  function addEvidence(itemId: string, files: FileList | null) {
    const answer = answers[itemId];
    if (!answer || !files?.length) return;
    const room = Math.max(0, 10 - answer.evidence.length);
    const drafts = Array.from(files)
      .slice(0, room)
      .map((file) => {
        const localId = `${file.name}-${file.lastModified}-${randomKey("qc-media")}`;
        if (!ALLOWED_MIME_TYPES.has(file.type)) {
          return {
            localId,
            file,
            state: "error" as const,
            error: "Chỉ chấp nhận JPEG, PNG hoặc WebP.",
            retryable: false,
          };
        }
        if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
          return {
            localId,
            file,
            state: "error" as const,
            error: "Mỗi ảnh phải có dung lượng từ 1 byte đến 15 MB.",
            retryable: false,
          };
        }
        return { localId, file, state: "presigning" as const, retryable: true };
      });
    updateAnswer(itemId, { evidence: [...answer.evidence, ...drafts] });
    for (const draft of drafts) {
      if (!draft.error) void startUpload(itemId, draft);
    }
  }

  function removeEvidence(itemId: string, localId: string) {
    const answer = answers[itemId];
    if (!answer) return;
    updateAnswer(itemId, {
      evidence: answer.evidence.filter((entry) => entry.localId !== localId),
    });
  }

  function buildInput(): CreateQcRunInput | null {
    if (!selectedTemplate) return null;
    return {
      qcTemplateId: selectedTemplate.id,
      expectedLockVersion: order.lockVersion,
      notes: failureNotes.trim() || null,
      results: selectedTemplate.items.map((item) => {
        const answer = answers[item.id]!;
        return {
          qcTemplateItemId: item.id,
          result: answer.result as QcItemResult,
          note: answer.note.trim() || null,
          evidenceMediaAssetIds: answer.evidence
            .filter((entry) => entry.state === "complete" && entry.mediaAssetId)
            .map((entry) => entry.mediaAssetId!),
        };
      }),
    };
  }

  function validateDraft(): boolean {
    const next: Record<string, string> = {};
    if (!selectedTemplate) next.template = "Chọn một mẫu QC đang hoạt động.";
    for (const item of selectedTemplate?.items ?? []) {
      const answer = answers[item.id];
      if (!answer?.result) next[`result:${item.id}`] = "Chọn một kết quả cho mục này.";
      if (answer?.result === "NOT_APPLICABLE" && !item.allowNa) {
        next[`result:${item.id}`] = "Mục này không cho phép chọn Không áp dụng.";
      }
      if ((answer?.note.length ?? 0) > 1000) {
        next[`note:${item.id}`] = "Ghi chú mỗi mục tối đa 1.000 ký tự.";
      }
      if (answer?.evidence.some((entry) => entry.state !== "complete")) {
        next[`evidence:${item.id}`] = "Hoàn tất hoặc xóa các ảnh đang lỗi trước khi tiếp tục.";
      }
    }
    if (previewResult === "FAIL" && !failureNotes.trim()) {
      next.failureNotes = "Kết quả không đạt cần ghi rõ lý do ở ghi chú chung.";
    }
    if (failureNotes.length > 5000) next.failureNotes = "Ghi chú chung tối đa 5.000 ký tự.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  function requestReview() {
    if (reviewRequired || !validateDraft()) return;
    setError("");
    setReviewOpen(true);
  }

  async function submitRun() {
    if (busyRef.current || reviewRequired || !validateDraft()) return;
    const input = buildInput();
    if (!input) return;
    const prepared = commandKey(submitCommand.current, "qc-run", input);
    submitCommand.current = prepared;
    busyRef.current = true;
    setBusy("submit");
    setError("");
    setMessage("");
    try {
      const result = await api.submitQcRun(shopId, order.id, input, prepared.key);
      const nextRuns = [...order.qcRuns.filter((run) => run.id !== result.run.id), result.run].sort(
        (left, right) => right.runNo - left.runNo,
      );
      onOrderChange({
        ...order,
        status: result.orderStatus,
        lockVersion: result.orderLockVersion,
        qcRuns: nextRuns,
      });
      submitCommand.current = undefined;
      setReviewOpen(false);
      setAnswers(emptyAnswers(selectedTemplate));
      setFailureNotes("");
      setMessage(
        result.run.result === "PASS"
          ? `Máy chủ ghi nhận QC lần ${result.run.runNo} đạt. Phiếu vẫn ở QC để xác nhận sẵn sàng trả máy.`
          : `Máy chủ ghi nhận QC lần ${result.run.runNo} không đạt và đã đưa phiếu về sửa chữa.`,
      );
      focusFeedback();
    } catch (reason) {
      setReviewOpen(false);
      const concurrent =
        reason instanceof RepairFlowApiError && reason.code === "CONCURRENT_UPDATE";
      if (concurrent || !(reason instanceof RepairFlowApiError) || reason.status === 0) {
        await onReload().catch(() => undefined);
      }
      if (concurrent) {
        setReviewRequired(true);
        setError(
          "Phiếu vừa thay đổi. Checklist và ảnh vẫn được giữ; hãy xem dữ liệu mới rồi xác nhận lại.",
        );
      } else if (reason instanceof RepairFlowApiError && reason.code === "IDEMPOTENCY_KEY_REUSED") {
        submitCommand.current = undefined;
        setReviewRequired(true);
        setError("Nội dung retry không còn khớp yêu cầu trước. Hãy xem lại trước khi gửi lại.");
      } else {
        setError(safeErrorMessage(reason));
        if (reason instanceof RepairFlowApiError) setFieldErrors(reason.fieldErrors);
      }
      focusFeedback();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function markReady() {
    if (busyRef.current || !showReady) return;
    const input = {
      targetStatus: "READY_FOR_PICKUP" as const,
      completionOutcome: "REPAIRED" as const,
      expectedLockVersion: order.lockVersion,
    };
    const prepared = commandKey(readyCommand.current, "qc-ready", input);
    readyCommand.current = prepared;
    busyRef.current = true;
    setBusy("ready");
    setError("");
    setMessage("");
    try {
      const summary = await api.transitionRepairOrder(shopId, order.id, input, prepared.key);
      onOrderChange({ ...order, ...summary, qcRuns: order.qcRuns });
      readyCommand.current = undefined;
      setMessage("Máy chủ đã xác nhận thiết bị sẵn sàng trả khách với kết quả Đã sửa xong.");
      focusFeedback();
    } catch (reason) {
      const concurrent =
        reason instanceof RepairFlowApiError && reason.code === "CONCURRENT_UPDATE";
      if (concurrent || !(reason instanceof RepairFlowApiError) || reason.status === 0) {
        await onReload().catch(() => undefined);
      }
      setError(
        concurrent
          ? "Phiếu vừa thay đổi. Dữ liệu mới đã được tải; hãy kiểm tra QC mới nhất."
          : safeErrorMessage(reason),
      );
      focusFeedback();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  return (
    <section className="qc-panel" aria-label="Kiểm tra chất lượng">
      <article className="workspace-card qc-history-card">
        <header className="qc-section-heading">
          <div>
            <p className="eyebrow">Lịch sử bất biến</p>
            <h2>Các lần kiểm tra chất lượng</h2>
            <p>Lần có runNo lớn nhất là kết quả hiện hành để quyết định trả máy.</p>
          </div>
          <span className="status-pill">{history.length} lần</span>
        </header>
        {history.length === 0 ? (
          <p className="empty-copy">
            Chưa có lần QC. Phiếu cần vào trạng thái Kiểm tra chất lượng và cửa hàng cần một mẫu
            đang hoạt động.
          </p>
        ) : (
          <ol className="qc-run-list">
            {history.map((run) => (
              <li className={run.runNo === latestRunNo ? "qc-run-latest" : ""} key={run.id}>
                <header>
                  <div>
                    <strong>
                      Lần {run.runNo} · {run.templateName} v{run.templateVersionNo}
                    </strong>
                    <small>
                      {dateTime(run.createdAt)} · Nhân viên {run.checkedByUserId.slice(0, 8)}
                    </small>
                  </div>
                  <div className="qc-run-badges">
                    {run.runNo === latestRunNo && <span className="status-pill">Mới nhất</span>}
                    <span className={`status-pill qc-result-${run.result.toLowerCase()}`}>
                      {run.result === "PASS" ? "Đạt" : "Không đạt"}
                    </span>
                  </div>
                </header>
                {run.notes && <p className="qc-run-notes">{run.notes}</p>}
                <ul className="qc-result-list">
                  {run.results.map((result) => (
                    <li key={result.id}>
                      <div>
                        <strong>{result.labelSnapshot}</strong>
                        {result.note && <small>{result.note}</small>}
                        {result.evidenceMediaAssetIds.length > 0 && (
                          <small>
                            {result.evidenceMediaAssetIds.length} ảnh bằng chứng đã xác minh
                          </small>
                        )}
                      </div>
                      <span>{RESULT_LABELS[result.result]}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </article>

      {latestRun?.result === "FAIL" && order.status === "REPAIRING" && (
        <p className="notice notice-info" role="status">
          QC lần {latestRun.runNo} không đạt. Máy chủ đã đưa phiếu trở lại Đang sửa; lần đạt cũ
          không thể mở thao tác trả máy.
        </p>
      )}

      {showReady && (
        <article className="workspace-card qc-ready-card">
          <div>
            <p className="eyebrow">Latest QC đã đạt</p>
            <h2>Xác nhận thiết bị sẵn sàng trả khách</h2>
            <p>
              Thao tác riêng này gửi outcome <strong>REPAIRED</strong> và lock version{" "}
              {order.lockVersion}.
            </p>
          </div>
          <button
            className="button button-primary"
            disabled={Boolean(busy)}
            onClick={() => void markReady()}
            type="button"
          >
            {busy === "ready" ? "Đang xác nhận…" : "Đánh dấu sẵn sàng trả máy"}
          </button>
        </article>
      )}

      {membership.role === "RECEPTIONIST" && (
        <p className="notice notice-info">
          Lễ tân được xem lịch sử QC và xác nhận trả máy sau kết quả mới nhất đạt, nhưng không thể
          thực hiện checklist kỹ thuật.
        </p>
      )}
      {membership.role === "TECHNICIAN" && !isAssigned && (
        <p className="notice notice-info">
          Phiếu không được phân công cho tài khoản này nên biểu mẫu QC đã bị khóa.
        </p>
      )}

      {canSubmit && order.status === "QUALITY_CHECK" && (
        <article className="workspace-card qc-form-card">
          <header className="qc-section-heading">
            <div>
              <p className="eyebrow">Checklist kỹ thuật</p>
              <h2>Ghi nhận lần QC mới</h2>
              <p>Kết quả tổng và runNo do máy chủ quyết định sau khi nhận đủ checklist.</p>
            </div>
            {membership.role === "OWNER" && (
              <Link className="button button-secondary" href={`/settings/qc?shopId=${shopId}`}>
                Quản lý mẫu
              </Link>
            )}
          </header>

          {templateState === "loading" && (
            <div className="qc-template-loading" aria-busy="true">
              <span className="spinner" aria-hidden="true" /> Đang tải mẫu QC…
            </div>
          )}
          {templateState === "error" && (
            <div className="notice notice-error" role="alert">
              <p>{templateError}</p>
              <button className="button button-secondary" onClick={() => void loadTemplates()}>
                Thử tải lại mẫu
              </button>
            </div>
          )}
          {templateState === "success" && templates.length === 0 && (
            <div className="empty-inline">
              <p>Chưa có mẫu QC đang hoạt động.</p>
              {membership.role === "OWNER" && (
                <Link className="button button-secondary" href={`/settings/qc?shopId=${shopId}`}>
                  Tạo mẫu QC
                </Link>
              )}
            </div>
          )}
          {selectedTemplate && (
            <>
              <label className="field qc-template-select">
                <span>Mẫu QC đang hoạt động</span>
                <select
                  aria-describedby={fieldErrors.template ? "qc-template-error" : undefined}
                  onChange={(event) => changeTemplate(event.target.value)}
                  value={selectedTemplateId}
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} · phiên bản {template.versionNo}
                    </option>
                  ))}
                </select>
                {fieldErrors.template && (
                  <small className="field-error" id="qc-template-error">
                    {fieldErrors.template}
                  </small>
                )}
              </label>

              <div className="qc-checklist">
                {selectedTemplate.items.map((item) => {
                  const answer = answers[item.id] ?? { result: "", note: "", evidence: [] };
                  return (
                    <fieldset className="qc-check-item" key={item.id}>
                      <legend>
                        <span>{item.sortOrder}</span>
                        {item.label}
                        {item.isRequired && <strong> Bắt buộc</strong>}
                      </legend>
                      <div
                        aria-describedby={
                          fieldErrors[`result:${item.id}`]
                            ? `qc-result-error-${item.id}`
                            : undefined
                        }
                        className="qc-result-options"
                      >
                        {itemResults(item).map((result) => (
                          <label key={result}>
                            <input
                              checked={answer.result === result}
                              name={`qc-result-${item.id}`}
                              onChange={() => updateAnswer(item.id, { result })}
                              type="radio"
                              value={result}
                            />
                            {RESULT_LABELS[result]}
                          </label>
                        ))}
                      </div>
                      {fieldErrors[`result:${item.id}`] && (
                        <small className="field-error" id={`qc-result-error-${item.id}`}>
                          {fieldErrors[`result:${item.id}`]}
                        </small>
                      )}
                      <label className="field">
                        <span>Ghi chú mục (không bắt buộc)</span>
                        <textarea
                          aria-describedby={
                            fieldErrors[`note:${item.id}`] ? `qc-note-error-${item.id}` : undefined
                          }
                          maxLength={1000}
                          onChange={(event) => updateAnswer(item.id, { note: event.target.value })}
                          rows={2}
                          value={answer.note}
                        />
                        {fieldErrors[`note:${item.id}`] && (
                          <small className="field-error" id={`qc-note-error-${item.id}`}>
                            {fieldErrors[`note:${item.id}`]}
                          </small>
                        )}
                      </label>
                      <div className="qc-evidence-control">
                        <label className="button button-secondary">
                          Thêm ảnh bằng chứng
                          <input
                            accept="image/jpeg,image/png,image/webp"
                            disabled={answer.evidence.length >= 10}
                            multiple
                            onChange={(event) => {
                              addEvidence(item.id, event.target.files);
                              event.target.value = "";
                            }}
                            type="file"
                          />
                        </label>
                        <small>Tối đa 10 ảnh JPEG, PNG hoặc WebP; mỗi ảnh không quá 15 MB.</small>
                      </div>
                      {answer.evidence.length > 0 && (
                        <ul className="qc-upload-list">
                          {answer.evidence.map((entry) => (
                            <li key={entry.localId}>
                              <div>
                                <strong>{entry.file.name}</strong>
                                <small>
                                  {fileSize(entry.file.size)} · {entry.error ?? "Đã tải lên"}
                                </small>
                              </div>
                              <span className={`qc-upload-state qc-upload-${entry.state}`}>
                                {entry.state === "complete"
                                  ? "Xong"
                                  : entry.state === "error"
                                    ? "Lỗi"
                                    : "Đang tải"}
                              </span>
                              {entry.state === "error" && entry.retryable && (
                                <button
                                  className="text-button"
                                  onClick={() => void startUpload(item.id, entry)}
                                  type="button"
                                >
                                  Thử lại
                                </button>
                              )}
                              <button
                                aria-label={`Xóa ${entry.file.name}`}
                                className="text-button"
                                onClick={() => removeEvidence(item.id, entry.localId)}
                                type="button"
                              >
                                Xóa
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {fieldErrors[`evidence:${item.id}`] && (
                        <small className="field-error">{fieldErrors[`evidence:${item.id}`]}</small>
                      )}
                    </fieldset>
                  );
                })}
              </div>

              <label className="field">
                <span>
                  Ghi chú chung {previewResult === "FAIL" ? "(bắt buộc)" : "(không bắt buộc)"}
                </span>
                <textarea
                  aria-describedby={fieldErrors.failureNotes ? "qc-failure-note-error" : undefined}
                  maxLength={5000}
                  onChange={(event) => {
                    setFailureNotes(event.target.value);
                    setFieldErrors((current) => ({ ...current, failureNotes: "" }));
                  }}
                  rows={4}
                  value={failureNotes}
                />
                {fieldErrors.failureNotes && (
                  <small className="field-error" id="qc-failure-note-error">
                    {fieldErrors.failureNotes}
                  </small>
                )}
              </label>

              {reviewRequired && (
                <div className="notice notice-info" role="status">
                  <p>Dữ liệu mới đã được tải, còn checklist của bạn vẫn được giữ.</p>
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setReviewRequired(false);
                      setError("");
                    }}
                    type="button"
                  >
                    Tôi đã xem dữ liệu mới
                  </button>
                </div>
              )}

              <button
                className="button button-primary"
                disabled={Boolean(busy) || reviewRequired}
                onClick={requestReview}
                ref={reviewButtonRef}
                type="button"
              >
                Xem lại checklist
              </button>
            </>
          )}
        </article>
      )}

      {message && (
        <p
          aria-live="polite"
          className="notice notice-success"
          ref={feedbackRef}
          role="status"
          tabIndex={-1}
        >
          {message}
        </p>
      )}
      {error && (
        <p
          aria-live="assertive"
          className="notice notice-error"
          ref={feedbackRef}
          role="alert"
          tabIndex={-1}
        >
          {error}
        </p>
      )}

      {reviewOpen && selectedTemplate && (
        <div className="qc-dialog-backdrop">
          <div
            aria-describedby="qc-review-description"
            aria-labelledby="qc-review-title"
            aria-modal="true"
            className="qc-dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="qc-review-title">Xác nhận gửi checklist QC</h2>
            <p id="qc-review-description">
              {selectedTemplate.name} · phiên bản {selectedTemplate.versionNo} · lock version{" "}
              {order.lockVersion}
            </p>
            <p className={`qc-review-result qc-result-${previewResult.toLowerCase()}`}>
              Dự kiến tại máy khách: {previewResult === "PASS" ? "Đạt" : "Không đạt"}. Máy chủ sẽ
              tính lại.
            </p>
            <ol className="qc-review-list">
              {selectedTemplate.items.map((item) => (
                <li key={item.id}>
                  <strong>{item.label}</strong>
                  <span>{RESULT_LABELS[answers[item.id]!.result as QcItemResult]}</span>
                  <small>
                    {
                      answers[item.id]!.evidence.filter((entry) => entry.state === "complete")
                        .length
                    }{" "}
                    ảnh
                  </small>
                </li>
              ))}
            </ol>
            {failureNotes.trim() && <p className="qc-run-notes">{failureNotes.trim()}</p>}
            <div className="qc-dialog-actions">
              <button className="button button-secondary" onClick={closeReview} type="button">
                Quay lại chỉnh sửa
              </button>
              <button
                className="button button-primary"
                disabled={busy === "submit"}
                onClick={() => void submitRun()}
                type="button"
              >
                {busy === "submit" ? "Đang gửi…" : "Gửi QC bất biến"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
