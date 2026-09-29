"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import type { AiCustomerSummaryApi } from "@/lib/api/intake-api";
import type {
  AiReviewOutcome,
  AiRunView,
  CustomerSummaryOutput,
  RepairOrderDetail,
} from "@/lib/api/types";

interface AiCustomerSummaryProps {
  api: AiCustomerSummaryApi;
  canInsert: boolean;
  onInsert(summary: string): void;
  order: RepairOrderDetail;
  pollDelaysMs?: readonly number[];
  shopId: string;
}

const DEFAULT_POLL_DELAYS = [250, 500, 1_000, 2_000, 3_000] as const;
function requestKey(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `customer-summary-${random}`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function isCustomerSummaryOutput(value: unknown): value is CustomerSummaryOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const output = value as Partial<CustomerSummaryOutput>;
  return (
    typeof output.summary === "string" &&
    Array.isArray(output.claimsUsed) &&
    output.claimsUsed.every((entry) => typeof entry === "string") &&
    Array.isArray(output.warnings) &&
    output.warnings.every((entry) => typeof entry === "string")
  );
}

function messageForRun(run: AiRunView): string {
  if (run.errorCode === "AI_BUDGET_EXCEEDED") return "Ngân sách AI của cửa hàng đã hết.";
  if (run.errorCode === "AI_FEATURE_DISABLED") return "Tính năng AI đang tắt.";
  if (run.errorCode === "AI_OUTPUT_INVALID")
    return "AI trả về nội dung không an toàn hoặc ngoài nguồn.";
  return "Không thể tạo bản nháp AI. Nội dung thủ công của bạn vẫn được giữ nguyên.";
}

export function AiCustomerSummary({
  api,
  canInsert,
  onInsert,
  order,
  pollDelaysMs = DEFAULT_POLL_DELAYS,
  shopId,
}: AiCustomerSummaryProps) {
  const currentDiagnoses = useMemo(() => {
    const superseded = new Set(
      order.diagnoses.map((diagnosis) => diagnosis.supersedesId).filter(Boolean),
    );
    return order.diagnoses.filter((diagnosis) => !superseded.has(diagnosis.id));
  }, [order.diagnoses]);
  const safeWorkLogs = useMemo(
    () =>
      order.workLogs.filter(
        (log) =>
          log.isEffective && (log.effectiveType === "REPAIR" || log.effectiveType === "TEST"),
      ),
    [order.workLogs],
  );
  const [diagnosisId, setDiagnosisId] = useState(currentDiagnoses[0]?.id ?? "");
  const [workLogIds, setWorkLogIds] = useState<string[]>([]);
  const [run, setRun] = useState<AiRunView | null>(null);
  const [originalOutput, setOriginalOutput] = useState<CustomerSummaryOutput | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const generationRef = useRef(0);
  const reviewingRef = useRef(false);

  useEffect(() => () => void (generationRef.current += 1), []);
  useEffect(() => {
    setDiagnosisId((current) =>
      current && !currentDiagnoses.some((diagnosis) => diagnosis.id === current)
        ? (currentDiagnoses[0]?.id ?? "")
        : current,
    );
    const allowedWorkLogIds = new Set(safeWorkLogs.map((workLog) => workLog.id));
    setWorkLogIds((current) => current.filter((id) => allowedWorkLogIds.has(id)));
  }, [currentDiagnoses, safeWorkLogs]);

  function toggleWorkLog(id: string) {
    setWorkLogIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  function applyTerminalRun(next: AiRunView): boolean {
    if (next.status === "SUCCEEDED" && isCustomerSummaryOutput(next.output)) {
      setRun(next);
      setOriginalOutput(next.output);
      setDraft(next.output.summary);
      setReviewed(Boolean(next.review));
      setError("");
      setStale(false);
      return true;
    }
    if (next.status === "FAILED" || next.status === "REJECTED") {
      setError(messageForRun(next));
      setStale(Boolean(draft));
      return true;
    }
    return false;
  }

  async function generate() {
    if (busy || (!diagnosisId && workLogIds.length === 0)) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setBusy(true);
    setError("");
    setMessage("");
    setStale(false);
    try {
      let next = await api.createCustomerSummary(
        shopId,
        {
          repairOrderId: order.id,
          ...(diagnosisId ? { diagnosisId } : {}),
          workLogIds,
          tone: "CLEAR_NEUTRAL",
          maxCharacters: 400,
        },
        requestKey(),
      );
      if (generationRef.current !== generation) return;
      if (applyTerminalRun(next)) return;
      for (const delay of pollDelaysMs) {
        await wait(delay);
        if (generationRef.current !== generation) return;
        next = await api.getAiRun(shopId, next.id);
        if (applyTerminalRun(next)) return;
      }
      if (generationRef.current === generation) {
        setError("AI vẫn đang xử lý. Bạn có thể thử tạo lại sau.");
        setStale(Boolean(draft));
      }
    } catch (reason) {
      if (generationRef.current === generation) {
        setError(safeErrorMessage(reason));
        setStale(Boolean(draft));
      }
    } finally {
      if (generationRef.current === generation) setBusy(false);
    }
  }

  function cancelPolling() {
    generationRef.current += 1;
    setBusy(false);
    setStale(Boolean(draft));
    setMessage("Đã dừng kiểm tra trạng thái. Tác vụ phía máy chủ có thể vẫn đang chạy.");
  }

  async function review(outcome: AiReviewOutcome): Promise<boolean> {
    if (!run || !originalOutput || reviewed || reviewingRef.current) return false;
    reviewingRef.current = true;
    try {
      await api.reviewAiRun(shopId, run.id, {
        outcome,
        ...(outcome === "REJECTED"
          ? {}
          : { reviewedOutput: { ...originalOutput, summary: draft.trim() } }),
      });
      setReviewed(true);
      return true;
    } catch (reason) {
      setError(safeErrorMessage(reason));
      return false;
    } finally {
      reviewingRef.current = false;
    }
  }

  function acceptedOutcome(): AiReviewOutcome {
    return draft.trim() === originalOutput?.summary ? "ACCEPTED_UNCHANGED" : "ACCEPTED_EDITED";
  }

  async function copyDraft() {
    if (!draft.trim() || reviewed) return;
    try {
      await navigator.clipboard.writeText(draft.trim());
    } catch {
      setError("Trình duyệt không cho phép sao chép vào clipboard.");
      return;
    }
    if (await review(acceptedOutcome())) setMessage("Đã sao chép và ghi nhận bản nháp.");
  }

  async function insertDraft() {
    if (!canInsert || !draft.trim() || reviewed) return;
    if (await review(acceptedOutcome())) {
      onInsert(draft.trim());
      setMessage("Đã chèn vào ghi chú báo giá. Hãy kiểm tra rồi lưu báo giá.");
    }
  }

  async function rejectDraft() {
    if (reviewed || !(await review("REJECTED"))) return;
    setDraft("");
    setMessage("Đã từ chối bản nháp AI.");
  }

  const hasSources = currentDiagnoses.length > 0 || safeWorkLogs.length > 0;

  return (
    <article className="workspace-card ai-summary-card" aria-labelledby="ai-summary-title">
      <header>
        <div>
          <p className="eyebrow">AI draft</p>
          <h2 id="ai-summary-title">Tóm tắt kỹ thuật cho khách</h2>
        </div>
        {stale && <span className="status-pill">Bản nháp cũ</span>}
      </header>
      <p>AI chỉ dùng dữ kiện bạn chọn. Hãy kiểm tra trước khi chèn hoặc gửi cho khách.</p>

      {hasSources ? (
        <fieldset className="ai-summary-sources" disabled={busy}>
          <legend>Nguồn dữ kiện</legend>
          {currentDiagnoses.map((diagnosis) => (
            <label key={diagnosis.id}>
              <input
                checked={diagnosisId === diagnosis.id}
                name="ai-summary-diagnosis"
                onChange={() => setDiagnosisId(diagnosisId === diagnosis.id ? "" : diagnosis.id)}
                type="checkbox"
              />
              Chẩn đoán #{diagnosis.revisionNo}: {diagnosis.finding}
            </label>
          ))}
          {safeWorkLogs.map((log) => (
            <label key={log.id}>
              <input
                checked={workLogIds.includes(log.id)}
                onChange={() => toggleWorkLog(log.id)}
                type="checkbox"
              />
              Nhật ký {log.effectiveType === "REPAIR" ? "sửa chữa" : "kiểm tra"}: {log.content}
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="empty-copy">Chưa có chẩn đoán hoặc nhật ký kỹ thuật phù hợp để tóm tắt.</p>
      )}

      <div className="workspace-actions ai-summary-actions">
        <button
          className="primary-action"
          disabled={busy || (!diagnosisId && workLogIds.length === 0)}
          onClick={() => void generate()}
          type="button"
        >
          {busy ? "Đang tạo bản nháp…" : "Tạo bản nháp AI"}
        </button>
        {busy && (
          <button className="secondary-action" onClick={cancelPolling} type="button">
            Dừng kiểm tra
          </button>
        )}
      </div>

      {busy && <p role="status">AI đang xử lý dữ kiện đã chọn…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}

      {originalOutput && (
        <div className="ai-summary-draft">
          <label htmlFor="ai-customer-summary-draft">Bản nháp để nhân viên kiểm tra</label>
          <textarea
            disabled={reviewed}
            id="ai-customer-summary-draft"
            maxLength={800}
            onChange={(event) => setDraft(event.target.value)}
            rows={6}
            value={draft}
          />
          {originalOutput.warnings.length > 0 && (
            <ul className="ai-summary-warnings">
              {originalOutput.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="workspace-actions ai-summary-actions">
            <button
              disabled={reviewed || !draft.trim()}
              onClick={() => void copyDraft()}
              type="button"
            >
              Sao chép
            </button>
            {canInsert && (
              <button
                className="primary-action"
                disabled={reviewed || !draft.trim()}
                onClick={() => void insertDraft()}
                type="button"
              >
                Chèn vào ghi chú báo giá
              </button>
            )}
            <button disabled={reviewed} onClick={() => void rejectDraft()} type="button">
              Từ chối bản nháp
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
