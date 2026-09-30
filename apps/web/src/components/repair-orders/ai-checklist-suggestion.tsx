"use client";

import { useEffect, useRef, useState } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { ChecklistSuggestionOutput, QcTemplate } from "@/lib/api/types";

export function AiChecklistSuggestion({
  api,
  shopId,
  repairOrderId,
  template,
  onApply,
  pollDelayMs = 750,
}: {
  api: RepairOrderWorkspaceApi;
  shopId: string;
  repairOrderId: string;
  template: QcTemplate;
  onApply(itemIds: string[]): void;
  pollDelayMs?: number;
}) {
  const [enabled, setEnabled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [state, setState] = useState<"idle" | "queued" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [runId, setRunId] = useState("");
  const [output, setOutput] = useState<ChecklistSuggestionOutput | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState(false);
  const key = useRef(randomKey());

  useEffect(() => {
    let active = true;
    if (!api.listAiCapabilities) {
      setChecked(true);
      return () => {
        active = false;
      };
    }
    void api
      .listAiCapabilities(shopId)
      .then((items) => {
        if (active) {
          setEnabled(
            Boolean(
              items.find((item) => item.capability === "CHECKLIST_SUGGESTION")?.effectiveEnabled,
            ),
          );
        }
      })
      .catch(() => {
        if (active) setEnabled(false);
      })
      .finally(() => {
        if (active) setChecked(true);
      });
    return () => {
      active = false;
    };
  }, [api, shopId]);

  useEffect(() => {
    setOutput(null);
    setSelected(new Set());
    setReviewed(false);
    setRunId("");
    setState("idle");
    key.current = randomKey();
  }, [template.id]);

  if (!checked || !enabled || !api.createChecklistSuggestion || !api.getAiRun || !api.reviewAiRun) {
    return null;
  }

  async function generate() {
    if (!api.createChecklistSuggestion || !api.getAiRun) return;
    setError("");
    setStale(false);
    setReviewed(false);
    setState("queued");
    try {
      let run = await api.createChecklistSuggestion(
        shopId,
        { repairOrderId, qcTemplateId: template.id, phase: "QC" },
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
      if (run.status !== "SUCCEEDED" || !isChecklistOutput(run.output)) {
        throw new Error(run.errorCode ?? "AI_CHECKLIST_SUGGESTION_FAILED");
      }
      const allowed = new Set(template.items.map((item) => item.id));
      if (run.output.suggestedItemIds.some((id) => !allowed.has(id))) {
        throw new Error("AI_OUTPUT_INVALID");
      }
      setOutput(run.output);
      setSelected(new Set(run.output.suggestedItemIds));
      setState("success");
      key.current = randomKey();
    } catch (reason) {
      setError(safeErrorMessage(reason));
      setStale(Boolean(output));
      setState("error");
    }
  }

  async function apply() {
    if (!output || !runId || !api.reviewAiRun) return;
    const reviewedOutput = { ...output, suggestedItemIds: [...selected].sort() };
    setError("");
    try {
      await api.reviewAiRun(shopId, runId, {
        outcome: sameIds(reviewedOutput.suggestedItemIds, output.suggestedItemIds)
          ? "ACCEPTED_UNCHANGED"
          : "ACCEPTED_EDITED",
        reviewedOutput,
      });
      onApply(reviewedOutput.suggestedItemIds);
      setReviewed(true);
    } catch (reason) {
      setError(safeErrorMessage(reason));
    }
  }

  async function reject() {
    if (!runId || !api.reviewAiRun) return;
    try {
      await api.reviewAiRun(shopId, runId, { outcome: "REJECTED" });
      setReviewed(true);
    } catch (reason) {
      setError(safeErrorMessage(reason));
    }
  }

  return (
    <section className="ai-checklist-suggestion" aria-label="AI gợi ý checklist">
      <div>
        <p className="eyebrow">AI draft</p>
        <h3>Gợi ý mục cần chú ý</h3>
        <p>AI chỉ chọn từ mẫu hiện tại và không ghi kết quả đạt hoặc không đạt.</p>
      </div>
      <button
        className="button button-secondary"
        type="button"
        disabled={state === "queued"}
        onClick={() => void generate()}
      >
        {state === "queued" ? "Đang tạo gợi ý…" : "Tạo gợi ý"}
      </button>
      {state === "queued" && <p role="status">AI đang đọc danh sách kiểm tra…</p>}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {stale && <p className="notice notice-info">Đang giữ gợi ý cũ do polling thất bại.</p>}
      {output && (
        <div className="ai-checklist-result">
          <p>
            <strong>Lý do:</strong> {output.reasoningSummary}
          </p>
          {output.safetyWarnings.length > 0 && (
            <ul>
              {output.safetyWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <fieldset disabled={reviewed}>
            <legend>Chọn mục muốn đánh dấu để nhân viên chú ý</legend>
            {template.items.map((item) => {
              const suggested = output.suggestedItemIds.includes(item.id);
              return (
                <label key={item.id} className={suggested ? "ai-suggested-option" : ""}>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      })
                    }
                  />
                  {item.label}
                  {suggested ? " · AI gợi ý" : ""}
                </label>
              );
            })}
          </fieldset>
          {reviewed ? (
            <p role="status">Đã ghi nhận review. Kết quả QC vẫn do nhân viên nhập.</p>
          ) : (
            <div className="ai-intake-actions">
              <button className="button button-primary" type="button" onClick={() => void apply()}>
                Áp dụng đánh dấu
              </button>
              <button className="button button-ghost" type="button" onClick={() => void reject()}>
                Bỏ qua
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function isChecklistOutput(value: unknown): value is ChecklistSuggestionOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const output = value as Record<string, unknown>;
  return (
    Array.isArray(output.suggestedItemIds) &&
    output.suggestedItemIds.every((item) => typeof item === "string") &&
    new Set(output.suggestedItemIds).size === output.suggestedItemIds.length &&
    typeof output.reasoningSummary === "string" &&
    output.reasoningSummary.trim().length > 0 &&
    Array.isArray(output.safetyWarnings) &&
    output.safetyWarnings.every((warning) => typeof warning === "string")
  );
}

function sameIds(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function randomKey(): string {
  return `ai-checklist-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
