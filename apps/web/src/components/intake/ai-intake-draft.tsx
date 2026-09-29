"use client";

import { useEffect, useRef, useState } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import type { IntakeApi } from "@/lib/api/intake-api";
import type { DeviceType, IntakeDraftOutput } from "@/lib/api/types";
import { createIdempotencyKey } from "@/lib/intake/intake-form";

type DraftField = "reportedProblem" | "visibleCondition" | "accessories";

interface AiIntakeDraftProps {
  api: IntakeApi;
  shopId: string;
  deviceType: DeviceType;
  current: {
    reportedProblem: string;
    intakeCondition: string;
    accessories: Array<{ name: string; conditionNote?: string | null }>;
  };
  onApply(values: {
    reportedProblem?: string;
    intakeCondition?: string;
    accessories?: Array<{ name: string; conditionNote: string }>;
  }): void;
  pollDelayMs?: number;
}

export function AiIntakeDraft({
  api,
  shopId,
  deviceType,
  current,
  onApply,
  pollDelayMs = 750,
}: AiIntakeDraftProps) {
  const [enabled, setEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [sourceType, setSourceType] = useState<"TEXT" | "TRANSCRIPT" | "AUDIO">("TEXT");
  const [sourceText, setSourceText] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioConsent, setAudioConsent] = useState(false);
  const [state, setState] = useState<"idle" | "uploading" | "queued" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [runId, setRunId] = useState("");
  const [output, setOutput] = useState<IntakeDraftOutput | null>(null);
  const [draftOutput, setDraftOutput] = useState<IntakeDraftOutput | null>(null);
  const [selected, setSelected] = useState<Set<DraftField>>(new Set());
  const [reviewed, setReviewed] = useState(false);
  const key = useRef(createIdempotencyKey());

  useEffect(() => {
    let active = true;
    if (!api.listAiCapabilities) {
      setAvailabilityChecked(true);
      return () => {
        active = false;
      };
    }
    void api
      .listAiCapabilities(shopId)
      .then((capabilities) => {
        if (!active) return;
        const intake = capabilities.find((item) => item.capability === "INTAKE_DRAFT");
        setEnabled(Boolean(intake?.effectiveEnabled));
        setAudioEnabled(Boolean(intake?.audioEffectiveEnabled));
      })
      .catch(() => {
        if (active) setEnabled(false);
      })
      .finally(() => {
        if (active) setAvailabilityChecked(true);
      });
    return () => {
      active = false;
    };
  }, [api, shopId]);

  if (
    !availabilityChecked ||
    !enabled ||
    !api.createIntakeDraft ||
    !api.getAiRun ||
    !api.reviewAiRun
  ) {
    return null;
  }

  async function generate() {
    if (!api.createIntakeDraft || !api.getAiRun) return;
    setError("");
    setStale(false);
    setReviewed(false);
    setSelected(new Set());
    let source:
      | { type: "TEXT"; text: string }
      | { type: "TRANSCRIPT"; text: string }
      | { type: "AUDIO"; mediaAssetId: string; consentAcknowledged: true };
    if (sourceType === "AUDIO") {
      if (!audioEnabled || !api.uploadIntakeAudio || !audioFile || !audioConsent) {
        setError("Hãy chọn file WAV và xác nhận khách hàng đồng ý ghi âm.");
        setState("error");
        return;
      }
      setState("uploading");
      try {
        const mediaAssetId = await api.uploadIntakeAudio(shopId, audioFile);
        source = { type: "AUDIO", mediaAssetId, consentAcknowledged: true };
      } catch (uploadError) {
        setError(safeErrorMessage(uploadError));
        setState("error");
        return;
      }
    } else {
      if (!sourceText.trim()) {
        setError("Nhập mô tả hoặc transcript trước khi tạo bản nháp.");
        setState("error");
        return;
      }
      source = { type: sourceType, text: sourceText };
    }

    setState("queued");
    try {
      let run = await api.createIntakeDraft(
        shopId,
        { source, deviceType, language: "vi" },
        key.current,
      );
      setRunId(run.id);
      for (
        let attempt = 0;
        attempt < 40 && (run.status === "QUEUED" || run.status === "RUNNING");
        attempt += 1
      ) {
        await delay(pollDelayMs);
        run = await api.getAiRun(shopId, run.id);
      }
      if (run.status !== "SUCCEEDED" || !isIntakeDraftOutput(run.output)) {
        throw new Error(run.errorCode ?? "AI_INTAKE_DRAFT_FAILED");
      }
      setOutput(run.output);
      setDraftOutput(run.output);
      setState("success");
      key.current = createIdempotencyKey();
    } catch (generationError) {
      setError(safeErrorMessage(generationError));
      setStale(Boolean(output));
      setState("error");
    }
  }

  function toggle(field: DraftField) {
    setSelected((currentSelection) => {
      const next = new Set(currentSelection);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function apply() {
    if (!output || !draftOutput || !runId || selected.size === 0 || !api.reviewAiRun) return;
    const reviewedOutput = normalizeDraftOutput(draftOutput);
    if (!reviewedOutput.reportedProblem || !reviewedOutput.visibleCondition) {
      setError("Lỗi khách báo và tình trạng bên ngoài không được để trống.");
      return;
    }
    const values: Parameters<AiIntakeDraftProps["onApply"]>[0] = {};
    if (selected.has("reportedProblem")) values.reportedProblem = reviewedOutput.reportedProblem;
    if (selected.has("visibleCondition")) values.intakeCondition = reviewedOutput.visibleCondition;
    if (selected.has("accessories")) {
      values.accessories = reviewedOutput.accessories.map((name) => ({ name, conditionNote: "" }));
    }
    setError("");
    try {
      await api.reviewAiRun(shopId, runId, {
        outcome:
          JSON.stringify(reviewedOutput) === JSON.stringify(output)
            ? "ACCEPTED_UNCHANGED"
            : "ACCEPTED_EDITED",
        reviewedOutput,
      });
      onApply(values);
      setReviewed(true);
    } catch (reviewError) {
      setError(safeErrorMessage(reviewError));
    }
  }

  async function reject() {
    if (!runId || !api.reviewAiRun) return;
    try {
      await api.reviewAiRun(shopId, runId, { outcome: "REJECTED" });
      setReviewed(true);
    } catch (reviewError) {
      setError(safeErrorMessage(reviewError));
    }
  }

  return (
    <section className="ai-intake-draft" aria-label="AI tạo bản nháp tiếp nhận">
      <p className="eyebrow">AI draft</p>
      <h3>Chuyển mô tả thành phiếu tiếp nhận</h3>
      <p>AI chỉ sắp xếp lại nội dung. Bạn chọn từng trường trước khi áp dụng.</p>
      <div className="ai-intake-source-tabs" role="group" aria-label="Nguồn nội dung">
        <button
          type="button"
          aria-pressed={sourceType === "TEXT"}
          onClick={() => setSourceType("TEXT")}
        >
          Nhập mô tả
        </button>
        <button
          type="button"
          aria-pressed={sourceType === "TRANSCRIPT"}
          onClick={() => setSourceType("TRANSCRIPT")}
        >
          Dán transcript
        </button>
        <button
          type="button"
          aria-pressed={sourceType === "AUDIO"}
          disabled={!audioEnabled}
          onClick={() => setSourceType("AUDIO")}
        >
          Ghi âm {audioEnabled ? "" : "(chưa khả dụng)"}
        </button>
      </div>
      {sourceType === "AUDIO" ? (
        <div className="ai-intake-audio">
          <label className="field">
            <span>File ghi âm WAV</span>
            <input
              type="file"
              accept="audio/wav,audio/x-wav"
              onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className="consent-box">
            <input
              type="checkbox"
              checked={audioConsent}
              onChange={(event) => setAudioConsent(event.target.checked)}
            />
            <span>Khách hàng đồng ý ghi âm để tạo bản nháp tiếp nhận.</span>
          </label>
        </div>
      ) : (
        <label className="field full-width">
          <span>{sourceType === "TEXT" ? "Mô tả tự do" : "Transcript đã có"}</span>
          <textarea
            value={sourceText}
            maxLength={8000}
            rows={4}
            onChange={(event) => setSourceText(event.target.value)}
          />
        </label>
      )}
      <button className="button button-secondary" type="button" onClick={() => void generate()}>
        Tạo bản nháp bằng AI
      </button>
      {state === "uploading" ? <p role="status">Đang tải bản ghi âm riêng tư…</p> : null}
      {state === "queued" ? <p role="status">AI đang sắp xếp thông tin…</p> : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {stale ? (
        <p className="notice notice-info">Kết quả cũ được giữ lại do polling thất bại.</p>
      ) : null}

      {output && draftOutput ? (
        <div className="ai-intake-comparison">
          <ComparisonField
            checked={selected.has("reportedProblem")}
            disabled={reviewed}
            label="Lỗi khách báo"
            current={current.reportedProblem}
            draft={draftOutput.reportedProblem}
            onDraftChange={(reportedProblem) =>
              setDraftOutput((currentDraft) =>
                currentDraft ? { ...currentDraft, reportedProblem } : currentDraft,
              )
            }
            onToggle={() => toggle("reportedProblem")}
          />
          <ComparisonField
            checked={selected.has("visibleCondition")}
            disabled={reviewed}
            label="Tình trạng bên ngoài"
            current={current.intakeCondition}
            draft={draftOutput.visibleCondition}
            onDraftChange={(visibleCondition) =>
              setDraftOutput((currentDraft) =>
                currentDraft ? { ...currentDraft, visibleCondition } : currentDraft,
              )
            }
            onToggle={() => toggle("visibleCondition")}
          />
          <ComparisonField
            checked={selected.has("accessories")}
            disabled={reviewed}
            label="Phụ kiện"
            current={current.accessories
              .map((item) => item.name)
              .filter(Boolean)
              .join(", ")}
            draft={draftOutput.accessories.join(", ")}
            onDraftChange={(accessories) =>
              setDraftOutput((currentDraft) =>
                currentDraft
                  ? { ...currentDraft, accessories: parseAccessories(accessories) }
                  : currentDraft,
              )
            }
            onToggle={() => toggle("accessories")}
          />
          <section>
            <strong>Lời khách kể</strong>
            <ul>
              {output.customerClaims.map((claim) => (
                <li key={claim}>{claim}</li>
              ))}
            </ul>
          </section>
          <section>
            <strong>Điểm chưa chắc chắn</strong>
            <ul>
              {output.uncertainties.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          {reviewed ? (
            <p role="status">Đã ghi nhận review. Bạn vẫn có thể sửa form thủ công.</p>
          ) : (
            <div className="ai-intake-actions">
              <button
                className="button button-primary"
                type="button"
                disabled={selected.size === 0}
                onClick={() => void apply()}
              >
                Áp dụng trường đã chọn
              </button>
              <button className="button button-ghost" type="button" onClick={() => void reject()}>
                Bỏ qua bản nháp
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ComparisonField(props: {
  checked: boolean;
  disabled: boolean;
  label: string;
  current: string;
  draft: string;
  onDraftChange(value: string): void;
  onToggle(): void;
}) {
  return (
    <div className="ai-intake-field">
      <input
        type="checkbox"
        aria-label={`Chọn ${props.label}`}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onToggle}
      />
      <span>
        <strong>{props.label}</strong>
        <small>Hiện tại: {props.current || "Chưa nhập"}</small>
        <label className="ai-intake-edit">
          <span>AI: {props.label}</span>
          <textarea
            value={props.draft}
            rows={2}
            disabled={props.disabled}
            onChange={(event) => props.onDraftChange(event.target.value)}
          />
        </label>
      </span>
    </div>
  );
}

function normalizeDraftOutput(value: IntakeDraftOutput): IntakeDraftOutput {
  return {
    reportedProblem: normalizeField(value.reportedProblem),
    visibleCondition: normalizeField(value.visibleCondition),
    accessories: value.accessories.map(normalizeField).filter(Boolean),
    customerClaims: value.customerClaims.map(normalizeField).filter(Boolean),
    uncertainties: value.uncertainties.map(normalizeField).filter(Boolean),
  };
}

function parseAccessories(value: string): string[] {
  return value.split(/[,\n]/u).map(normalizeField).filter(Boolean);
}

function normalizeField(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function isIntakeDraftOutput(value: unknown): value is IntakeDraftOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const output = value as Record<string, unknown>;
  return (
    typeof output.reportedProblem === "string" &&
    typeof output.visibleCondition === "string" &&
    Array.isArray(output.accessories) &&
    Array.isArray(output.customerClaims) &&
    Array.isArray(output.uncertainties)
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
