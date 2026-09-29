"use client";

import { useEffect, useRef, useState } from "react";

import { safeErrorMessage } from "@/lib/api/errors";
import type { IntakeApi } from "@/lib/api/intake-api";
import type { DeviceOcrField, DeviceOcrOutput, NewDevice } from "@/lib/api/types";
import { createIdempotencyKey } from "@/lib/intake/intake-form";

const FIELDS: ReadonlyArray<{
  key: DeviceOcrField;
  label: string;
  currentKey: "brand" | "model" | "serial" | "imei";
}> = [
  { key: "brand", label: "Hãng", currentKey: "brand" },
  { key: "model", label: "Model", currentKey: "model" },
  { key: "serialNumber", label: "Serial", currentKey: "serial" },
  { key: "imei", label: "IMEI", currentKey: "imei" },
];

interface AiDeviceOcrProps {
  api: IntakeApi;
  shopId: string;
  current: NewDevice;
  onMediaUploaded(file: File, mediaAssetId: string): void;
  onApply(values: Partial<Pick<NewDevice, "brand" | "model" | "serial" | "imei">>): void;
  pollDelayMs?: number;
}

type OcrState = "idle" | "uploading" | "ready" | "queued" | "success" | "error";

export function AiDeviceOcr({
  api,
  shopId,
  current,
  onMediaUploaded,
  onApply,
  pollDelayMs = 750,
}: AiDeviceOcrProps) {
  const [enabled, setEnabled] = useState(false);
  const [checkedAvailability, setCheckedAvailability] = useState(false);
  const [state, setState] = useState<OcrState>("idle");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [mediaAssetId, setMediaAssetId] = useState("");
  const [runId, setRunId] = useState("");
  const [output, setOutput] = useState<DeviceOcrOutput | null>(null);
  const [selected, setSelected] = useState<Set<DeviceOcrField>>(new Set());
  const [reviewed, setReviewed] = useState(false);
  const key = useRef(createIdempotencyKey());

  useEffect(() => {
    let active = true;
    if (!api.listAiCapabilities) {
      setCheckedAvailability(true);
      return () => {
        active = false;
      };
    }
    void api
      .listAiCapabilities(shopId)
      .then((capabilities) => {
        if (!active) return;
        setEnabled(
          capabilities.some(
            (capability) => capability.capability === "DEVICE_OCR" && capability.effectiveEnabled,
          ),
        );
      })
      .catch(() => {
        if (active) setEnabled(false);
      })
      .finally(() => {
        if (active) setCheckedAvailability(true);
      });
    return () => {
      active = false;
    };
  }, [api, shopId]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  if (
    !checkedAvailability ||
    !enabled ||
    !api.createDeviceOcr ||
    !api.getAiRun ||
    !api.reviewAiRun
  ) {
    return null;
  }

  async function selectImage(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    event.target.value = "";
    if (!next) return;
    setMediaAssetId("");
    setOutput(null);
    setSelected(new Set());
    setReviewed(false);
    setRunId("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(next.type)) {
      setFile(null);
      setError("Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.");
      setState("error");
      return;
    }
    if (next.size < 1 || next.size > 10_000_000) {
      setFile(null);
      setError("Ảnh OCR phải nhỏ hơn hoặc bằng 10 MB.");
      setState("error");
      return;
    }
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setError("");
    setState("uploading");
    key.current = createIdempotencyKey();
    try {
      const uploadedId = await api.uploadIntakeMedia(shopId, next);
      setMediaAssetId(uploadedId);
      onMediaUploaded(next, uploadedId);
      setState("ready");
    } catch (uploadError) {
      setError(safeErrorMessage(uploadError));
      setState("error");
    }
  }

  async function scan() {
    if (!mediaAssetId || !api.createDeviceOcr || !api.getAiRun) return;
    setError("");
    setState("queued");
    try {
      let run = await api.createDeviceOcr(
        shopId,
        { mediaAssetId, allowedFields: FIELDS.map((field) => field.key) },
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
      if (run.status !== "SUCCEEDED" || !isDeviceOcrOutput(run.output)) {
        throw new Error(run.errorCode ?? "AI_DEVICE_OCR_FAILED");
      }
      setOutput(run.output);
      setSelected(new Set());
      setState("success");
    } catch (scanError) {
      setError(safeErrorMessage(scanError));
      setState("error");
    }
  }

  function toggle(field: DeviceOcrField) {
    setSelected((currentSelection) => {
      const next = new Set(currentSelection);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function apply() {
    if (!output || !runId || selected.size === 0 || !api.reviewAiRun) return;
    const reviewedOutput = maskedReviewOutput(output, selected);
    const unchanged = JSON.stringify(reviewedOutput) === JSON.stringify(output);
    setError("");
    try {
      await api.reviewAiRun(shopId, runId, {
        outcome: unchanged ? "ACCEPTED_UNCHANGED" : "ACCEPTED_EDITED",
        reviewedOutput,
      });
      const values: Partial<Pick<NewDevice, "brand" | "model" | "serial" | "imei">> = {};
      for (const field of FIELDS) {
        if (!selected.has(field.key)) continue;
        const value = output[field.key].value;
        if (value !== null) values[field.currentKey] = value;
      }
      onApply(values);
      setReviewed(true);
    } catch (reviewError) {
      setError(safeErrorMessage(reviewError));
    }
  }

  async function reject() {
    if (!runId || !api.reviewAiRun) return;
    setError("");
    try {
      await api.reviewAiRun(shopId, runId, { outcome: "REJECTED" });
      setReviewed(true);
    } catch (reviewError) {
      setError(safeErrorMessage(reviewError));
    }
  }

  return (
    <section className="ai-device-ocr" aria-label="AI đọc thông tin thiết bị">
      <header>
        <div>
          <p className="eyebrow">AI draft</p>
          <h3>Đọc nhãn thiết bị từ ảnh</h3>
          <p>AI chỉ gợi ý. Bạn chọn từng trường trước khi áp dụng vào form.</p>
        </div>
      </header>
      <label className="ocr-file-picker">
        <span>Ảnh nhãn máy hoặc màn hình thông tin</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} />
      </label>
      {file ? <small>{file.name}</small> : null}
      {state === "uploading" ? <p role="status">Đang tải ảnh vào kho riêng tư…</p> : null}
      {state === "ready" || state === "error" ? (
        <button
          className="button button-secondary"
          type="button"
          disabled={!mediaAssetId}
          onClick={() => void scan()}
        >
          Quét thông tin bằng AI
        </button>
      ) : null}
      {state === "queued" ? <p role="status">AI đang đọc ảnh… Bạn vẫn có thể nhập tay.</p> : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      {state === "success" && output ? (
        <div className="ocr-comparison">
          {previewUrl ? <img src={previewUrl} alt="Ảnh dùng để đọc thông tin thiết bị" /> : null}
          <div className="ocr-fields">
            {FIELDS.map((field) => {
              const candidate = output[field.key];
              const hasValue = candidate.value !== null;
              return (
                <label className="ocr-field" key={field.key}>
                  <input
                    type="checkbox"
                    checked={selected.has(field.key)}
                    disabled={!hasValue || reviewed}
                    onChange={() => toggle(field.key)}
                  />
                  <span>
                    <strong>{field.label}</strong>
                    <small>Hiện tại: {current[field.currentKey] || "Chưa nhập"}</small>
                    <b>AI: {candidate.value ?? "Không đọc chắc chắn"}</b>
                    <small>Độ tin cậy: {Math.round(candidate.confidence * 100)}%</small>
                  </span>
                </label>
              );
            })}
          </div>
          {output.warnings.length ? (
            <ul className="ocr-warnings">
              {output.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {reviewed ? (
            <p role="status">Đã ghi nhận lựa chọn. Bạn vẫn có thể sửa các ô trong form.</p>
          ) : (
            <div className="ocr-actions">
              <button
                className="button button-primary"
                type="button"
                disabled={!selected.size}
                onClick={() => void apply()}
              >
                Áp dụng trường đã chọn
              </button>
              <button className="button button-ghost" type="button" onClick={() => void reject()}>
                Bỏ qua gợi ý
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function maskedReviewOutput(
  output: DeviceOcrOutput,
  selected: ReadonlySet<DeviceOcrField>,
): DeviceOcrOutput {
  return {
    brand: selected.has("brand") ? output.brand : { value: null, confidence: 0 },
    model: selected.has("model") ? output.model : { value: null, confidence: 0 },
    serialNumber: selected.has("serialNumber")
      ? output.serialNumber
      : { value: null, confidence: 0 },
    imei: selected.has("imei") ? output.imei : { value: null, confidence: 0 },
    warnings: output.warnings,
  };
}

function isDeviceOcrOutput(value: unknown): value is DeviceOcrOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    FIELDS.every(({ key }) => {
      const candidate = record[key];
      return Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate);
    }) && Array.isArray(record.warnings)
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
