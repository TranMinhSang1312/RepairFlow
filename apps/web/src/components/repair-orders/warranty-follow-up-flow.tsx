"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { RepairFlowApiError } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi, UploadProgress } from "@/lib/api/intake-api";
import type {
  CreateWarrantyFollowUpInput,
  IntakeAccessory,
  Membership,
  Priority,
  RepairOrderDetail,
} from "@/lib/api/types";

interface WarrantyFollowUpFlowProps {
  api: RepairOrderWorkspaceApi;
  membership: Membership;
  order: RepairOrderDetail;
  shopId: string;
  onReload(): Promise<void>;
}

interface PendingMedia {
  id: string;
  file: File;
  stage: UploadProgress["stage"] | "error";
  mediaAssetId: string | null;
  error: string;
}

type PreparedCommand = { fingerprint: string; key: string };
type FieldErrors = Record<string, string>;

const PRIORITIES: Array<{ value: Priority; label: string }> = [
  { value: "LOW", label: "Thấp" },
  { value: "NORMAL", label: "Bình thường" },
  { value: "HIGH", label: "Cao" },
  { value: "URGENT", label: "Khẩn cấp" },
];
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 15_000_000;
const MAX_MEDIA = 20;

function randomKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `warranty-${Date.now()}-${Math.random()}`;
}

function mediaId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`;
}

export function WarrantyFollowUpFlow({
  api,
  membership,
  order,
  shopId,
  onReload,
}: WarrantyFollowUpFlowProps) {
  const canMutate = membership.role === "OWNER" || membership.role === "RECEPTIONIST";
  const sourceCompleted = order.status === "COMPLETED" && Boolean(order.warranty);
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState(order.branchId);
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [reportedProblem, setReportedProblem] = useState("");
  const [intakeCondition, setIntakeCondition] = useState("");
  const [promisedAt, setPromisedAt] = useState("");
  const [accessories, setAccessories] = useState<IntakeAccessory[]>([]);
  const [eligibilityConfirmed, setEligibilityConfirmed] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<RepairOrderDetail | null>(null);
  const command = useRef<PreparedCommand | undefined>(undefined);
  const busyRef = useRef(false);

  function changed() {
    command.current = undefined;
    setSubmitError("");
  }

  function updateAccessory(index: number, field: keyof IntakeAccessory, value: string) {
    setAccessories((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    );
    changed();
  }

  async function uploadOne(item: PendingMedia) {
    setMedia((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, stage: "presigning", error: "" } : candidate,
      ),
    );
    try {
      const assetId = await api.uploadIntakeMedia(shopId, item.file, ({ stage }) => {
        setMedia((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, stage } : candidate,
          ),
        );
      });
      setMedia((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, mediaAssetId: assetId, stage: "complete", error: "" }
            : candidate,
        ),
      );
    } catch {
      setMedia((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, mediaAssetId: null, stage: "error", error: "Tải ảnh thất bại." }
            : candidate,
        ),
      );
    }
  }

  function selectFiles(files: FileList | null) {
    if (!files) return;
    const available = Math.max(0, MAX_MEDIA - media.length);
    const next: PendingMedia[] = Array.from(files)
      .slice(0, available)
      .map((file) => {
        let error = "";
        if (!ALLOWED_MIME_TYPES.has(file.type)) error = "Chỉ hỗ trợ JPEG, PNG hoặc WebP.";
        else if (file.size < 1 || file.size > MAX_UPLOAD_BYTES)
          error = "Ảnh phải từ 1 byte đến 15 MB.";
        return {
          id: mediaId(file),
          file,
          stage: error ? "error" : "presigning",
          mediaAssetId: null,
          error,
        };
      });
    setMedia((current) => [...current, ...next]);
    changed();
    for (const item of next) {
      if (!item.error) void uploadOne(item);
    }
  }

  function buildInput(): CreateWarrantyFollowUpInput | null {
    const nextErrors: FieldErrors = {};
    if (!branchId) nextErrors.branchId = "Vui lòng chọn chi nhánh tiếp nhận.";
    if (!reportedProblem.trim()) nextErrors.reportedProblem = "Vui lòng mô tả vấn đề tái phát.";
    else if (reportedProblem.trim().length > 5000)
      nextErrors.reportedProblem = "Tối đa 5.000 ký tự.";
    if (!intakeCondition.trim())
      nextErrors.intakeCondition = "Vui lòng ghi tình trạng thiết bị khi nhận lại.";
    else if (intakeCondition.trim().length > 5000)
      nextErrors.intakeCondition = "Tối đa 5.000 ký tự.";
    if (!eligibilityConfirmed)
      nextErrors.eligibilityConfirmed = "Nhân viên phải xác nhận đã kiểm tra điều kiện bảo hành.";
    if (!consentAccepted)
      nextErrors.consentAccepted = "Cần xác nhận đồng ý tiếp nhận và xử lý dữ liệu.";
    accessories.forEach((item, index) => {
      if (!item.name.trim()) nextErrors[`accessory-${index}`] = "Tên phụ kiện là bắt buộc.";
      else if (item.name.trim().length > 200)
        nextErrors[`accessory-${index}`] = "Tên tối đa 200 ký tự.";
      if ((item.conditionNote ?? "").trim().length > 1000)
        nextErrors[`condition-${index}`] = "Ghi chú tối đa 1.000 ký tự.";
    });
    const uploading = media.some(
      (item) => item.stage === "presigning" || item.stage === "uploading",
    );
    const uploaded = media.flatMap((item) => (item.mediaAssetId ? [item.mediaAssetId] : []));
    if (uploading) nextErrors.media = "Hãy chờ tất cả ảnh tải lên hoàn tất.";
    else if (uploaded.length < Math.max(1, membership.intakePhotoMinimum)) {
      nextErrors.media = `Cần ít nhất ${Math.max(1, membership.intakePhotoMinimum)} ảnh tiếp nhận đã tải lên.`;
    }
    if (promisedAt && Number.isNaN(new Date(promisedAt).getTime()))
      nextErrors.promisedAt = "Thời gian hẹn trả không hợp lệ.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return null;
    return {
      eligibilityConfirmed: true,
      branchId,
      priority,
      reportedProblem: reportedProblem.trim(),
      intakeCondition: intakeCondition.trim(),
      consentAccepted: true,
      promisedAt: promisedAt ? new Date(promisedAt).toISOString() : null,
      accessories: accessories.map((item) => ({
        name: item.name.trim(),
        conditionNote: item.conditionNote?.trim() || null,
      })),
      intakeMediaAssetIds: uploaded,
    };
  }

  async function submit() {
    if (!canMutate || busyRef.current) return;
    const input = buildInput();
    if (!input) return;
    const fingerprint = JSON.stringify(input);
    const prepared =
      command.current?.fingerprint === fingerprint
        ? command.current
        : { fingerprint, key: randomKey() };
    command.current = prepared;
    busyRef.current = true;
    setBusy(true);
    setSubmitError("");
    try {
      const result = await api.createWarrantyFollowUp(shopId, order.id, input, prepared.key);
      setCreated(result);
      await onReload();
    } catch (error) {
      if (error instanceof RepairFlowApiError && error.code === "IDEMPOTENCY_KEY_REUSED") {
        command.current = undefined;
        setSubmitError(
          "Nội dung không còn khớp với lần gửi trước. Hãy kiểm tra lại trước khi gửi.",
        );
      } else if (error instanceof RepairFlowApiError && error.status === 409) {
        await onReload();
        setSubmitError(
          "Phiếu nguồn vừa thay đổi. Dữ liệu nhập vẫn được giữ; hãy kiểm tra lại điều kiện bảo hành.",
        );
      } else if (error instanceof RepairFlowApiError && error.status === 422) {
        setSubmitError(
          "Máy chủ từ chối điều kiện bảo hành hoặc dữ liệu tiếp nhận. Hãy kiểm tra lại.",
        );
      } else {
        setSubmitError("Chưa thể tạo phiếu bảo hành. Dữ liệu vẫn được giữ để thử lại.");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="workspace-card warranty-follow-up-card"
      aria-labelledby="warranty-follow-up-heading"
    >
      <header>
        <p className="eyebrow">Liên kết bảo hành</p>
        <h2 id="warranty-follow-up-heading">Phiếu nguồn và các lần quay lại</h2>
      </header>
      {order.sourceOrder && (
        <p className="linked-order-line">
          Phiếu nguồn: <strong>{order.sourceOrder.code}</strong> · {order.sourceOrder.status}
        </p>
      )}
      {order.followUpOrders?.length ? (
        <ul className="linked-order-list">
          {order.followUpOrders.map((item) => (
            <li key={`${item.code}-${item.receivedAt}`}>
              <strong>{item.code}</strong>
              <span>
                {item.serviceType} · {item.status}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-copy">Chưa có phiếu bảo hành phát sinh từ phiếu này.</p>
      )}

      {created ? (
        <div className="notice notice-success warranty-success" role="status">
          <strong>Đã tạo phiếu {created.code}.</strong>
          <Link
            href={`/orders/${encodeURIComponent(created.id)}?shopId=${encodeURIComponent(shopId)}`}
          >
            Mở phiếu bảo hành
          </Link>
        </div>
      ) : canMutate && sourceCompleted ? (
        <>
          {!open ? (
            <button className="button button-secondary" onClick={() => setOpen(true)} type="button">
              Tạo phiếu bảo hành
            </button>
          ) : (
            <div className="warranty-form">
              <div
                className="source-snapshot"
                aria-label="Snapshot khách hàng và thiết bị của phiếu nguồn"
              >
                <p className="eyebrow">Snapshot bất biến từ phiếu nguồn</p>
                <strong>{order.customer.name}</strong>
                <span>{order.customer.phone}</span>
                <span>
                  {order.device.brand} {order.device.model} ·{" "}
                  {order.device.serialMasked ?? order.device.imeiMasked ?? "Không có mã nhận diện"}
                </span>
                <small>
                  Thông tin này được máy chủ kế thừa; không tìm kiếm hoặc thay thế hồ sơ khác.
                </small>
              </div>
              <div className="warranty-form-grid">
                <label className="field">
                  <span>Chi nhánh tiếp nhận</span>
                  <select
                    aria-describedby={errors.branchId ? "warranty-branch-error" : undefined}
                    aria-invalid={Boolean(errors.branchId)}
                    value={branchId}
                    onChange={(event) => {
                      setBranchId(event.target.value);
                      changed();
                    }}
                  >
                    {membership.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                  {errors.branchId && (
                    <small className="field-error" id="warranty-branch-error">
                      {errors.branchId}
                    </small>
                  )}
                </label>
                <label className="field">
                  <span>Mức ưu tiên</span>
                  <select
                    value={priority}
                    onChange={(event) => {
                      setPriority(event.target.value as Priority);
                      changed();
                    }}
                  >
                    {PRIORITIES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field warranty-wide-field">
                  <span>Vấn đề bảo hành</span>
                  <textarea
                    aria-describedby={errors.reportedProblem ? "warranty-problem-error" : undefined}
                    aria-invalid={Boolean(errors.reportedProblem)}
                    maxLength={5000}
                    rows={4}
                    value={reportedProblem}
                    onChange={(event) => {
                      setReportedProblem(event.target.value);
                      changed();
                    }}
                  />
                  {errors.reportedProblem && (
                    <small className="field-error" id="warranty-problem-error">
                      {errors.reportedProblem}
                    </small>
                  )}
                </label>
                <label className="field warranty-wide-field">
                  <span>Tình trạng khi nhận lại</span>
                  <textarea
                    aria-describedby={
                      errors.intakeCondition ? "warranty-condition-error" : undefined
                    }
                    aria-invalid={Boolean(errors.intakeCondition)}
                    maxLength={5000}
                    rows={4}
                    value={intakeCondition}
                    onChange={(event) => {
                      setIntakeCondition(event.target.value);
                      changed();
                    }}
                  />
                  {errors.intakeCondition && (
                    <small className="field-error" id="warranty-condition-error">
                      {errors.intakeCondition}
                    </small>
                  )}
                </label>
                <label className="field">
                  <span>Hẹn trả dự kiến (không bắt buộc)</span>
                  <input
                    aria-describedby={errors.promisedAt ? "warranty-promised-error" : undefined}
                    aria-invalid={Boolean(errors.promisedAt)}
                    type="datetime-local"
                    value={promisedAt}
                    onChange={(event) => {
                      setPromisedAt(event.target.value);
                      changed();
                    }}
                  />
                  {errors.promisedAt && (
                    <small className="field-error" id="warranty-promised-error">
                      {errors.promisedAt}
                    </small>
                  )}
                </label>
              </div>

              <div className="warranty-accessories">
                <div className="section-inline-heading">
                  <h3>Phụ kiện lần tiếp nhận mới</h3>
                  <button
                    className="button button-secondary"
                    disabled={accessories.length >= 50}
                    onClick={() => {
                      setAccessories((current) => [...current, { name: "", conditionNote: null }]);
                      changed();
                    }}
                    type="button"
                  >
                    Thêm phụ kiện
                  </button>
                </div>
                {accessories.map((item, index) => (
                  <div className="accessory-row" key={index}>
                    <label className="field">
                      <span>Tên phụ kiện</span>
                      <input
                        aria-describedby={
                          errors[`accessory-${index}`]
                            ? `warranty-accessory-${index}-error`
                            : undefined
                        }
                        aria-invalid={Boolean(errors[`accessory-${index}`])}
                        maxLength={200}
                        value={item.name}
                        onChange={(event) => updateAccessory(index, "name", event.target.value)}
                      />
                      {errors[`accessory-${index}`] && (
                        <small className="field-error" id={`warranty-accessory-${index}-error`}>
                          {errors[`accessory-${index}`]}
                        </small>
                      )}
                    </label>
                    <label className="field">
                      <span>Tình trạng</span>
                      <input
                        aria-describedby={
                          errors[`condition-${index}`]
                            ? `warranty-accessory-condition-${index}-error`
                            : undefined
                        }
                        aria-invalid={Boolean(errors[`condition-${index}`])}
                        maxLength={1000}
                        value={item.conditionNote ?? ""}
                        onChange={(event) =>
                          updateAccessory(index, "conditionNote", event.target.value)
                        }
                      />
                      {errors[`condition-${index}`] && (
                        <small
                          className="field-error"
                          id={`warranty-accessory-condition-${index}-error`}
                        >
                          {errors[`condition-${index}`]}
                        </small>
                      )}
                    </label>
                    <button
                      aria-label={`Xóa phụ kiện ${index + 1}`}
                      className="button button-secondary"
                      onClick={() => {
                        setAccessories((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        );
                        changed();
                      }}
                      type="button"
                    >
                      Xóa
                    </button>
                  </div>
                ))}
              </div>

              <div className="warranty-media">
                <label className="field">
                  <span>Ảnh tiếp nhận mới (JPEG/PNG/WebP, tối đa 15 MB/ảnh)</span>
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    aria-describedby={errors.media ? "warranty-media-error" : undefined}
                    aria-invalid={Boolean(errors.media)}
                    multiple
                    onChange={(event) => selectFiles(event.target.files)}
                    type="file"
                  />
                </label>
                <p className="field-hint">
                  Yêu cầu tối thiểu {Math.max(1, membership.intakePhotoMinimum)} ảnh đã tải lên; tối
                  đa 20 ảnh.
                </p>
                {errors.media && (
                  <small className="field-error" id="warranty-media-error">
                    {errors.media}
                  </small>
                )}
                {media.length > 0 && (
                  <ul className="upload-list">
                    {media.map((item) => (
                      <li key={item.id}>
                        <span>{item.file.name}</span>
                        <span>
                          {item.stage === "complete"
                            ? "Đã tải lên"
                            : item.stage === "error"
                              ? item.error
                              : "Đang tải…"}
                        </span>
                        {item.stage === "error" &&
                          !item.error.startsWith("Chỉ") &&
                          !item.error.startsWith("Ảnh") && (
                            <button
                              className="button-link"
                              onClick={() => void uploadOne(item)}
                              type="button"
                            >
                              Thử lại
                            </button>
                          )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <label className="public-confirm-check">
                <input
                  aria-describedby={
                    errors.eligibilityConfirmed ? "warranty-eligibility-error" : undefined
                  }
                  aria-invalid={Boolean(errors.eligibilityConfirmed)}
                  checked={eligibilityConfirmed}
                  onChange={(event) => {
                    setEligibilityConfirmed(event.target.checked);
                    changed();
                  }}
                  type="checkbox"
                />
                <span>
                  Tôi đã đối chiếu phiếu nguồn và xác nhận yêu cầu thuộc phạm vi bảo hành. Máy chủ
                  sẽ kiểm tra lại điều kiện này.
                </span>
              </label>
              {errors.eligibilityConfirmed && (
                <small className="field-error" id="warranty-eligibility-error">
                  {errors.eligibilityConfirmed}
                </small>
              )}
              <label className="public-confirm-check">
                <input
                  aria-describedby={errors.consentAccepted ? "warranty-consent-error" : undefined}
                  aria-invalid={Boolean(errors.consentAccepted)}
                  checked={consentAccepted}
                  onChange={(event) => {
                    setConsentAccepted(event.target.checked);
                    changed();
                  }}
                  type="checkbox"
                />
                <span>
                  Khách hàng đồng ý tiếp nhận thiết bị và xử lý dữ liệu cho lần bảo hành này.
                </span>
              </label>
              {errors.consentAccepted && (
                <small className="field-error" id="warranty-consent-error">
                  {errors.consentAccepted}
                </small>
              )}
              {submitError && (
                <p className="notice notice-error" role="alert">
                  {submitError}
                </p>
              )}
              <div className="warranty-actions">
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  Đóng
                </button>
                <button
                  className="button button-primary"
                  disabled={
                    busy ||
                    media.some((item) => item.stage === "presigning" || item.stage === "uploading")
                  }
                  onClick={() => void submit()}
                  type="button"
                >
                  {busy ? "Đang tạo phiếu…" : "Tạo phiếu bảo hành"}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="empty-copy">
          {canMutate
            ? "Máy chủ chưa cung cấp bảo hành trên một phiếu đã hoàn tất để tạo lần tiếp nhận mới."
            : "Chỉ owner hoặc receptionist có thể tạo phiếu bảo hành mới."}
        </p>
      )}
    </section>
  );
}
