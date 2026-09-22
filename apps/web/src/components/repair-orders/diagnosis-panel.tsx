"use client";

import { useState } from "react";

import { RepairFlowApiError, safeErrorMessage } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { Diagnosis, Membership, RepairOrderDetail } from "@/lib/api/types";

interface DiagnosisPanelProps {
  api: RepairOrderWorkspaceApi;
  membership: Membership;
  order: RepairOrderDetail;
  shopId: string;
  userId: string;
  onReload(): Promise<void>;
}

export function DiagnosisPanel({
  api,
  membership,
  order,
  shopId,
  userId,
  onReload,
}: DiagnosisPanelProps) {
  const [finding, setFinding] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [supersedesId, setSupersedesId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const assignedToUser = order.activeAssignment?.technicianUserId === userId;
  const canPublish =
    order.status === "DIAGNOSING" &&
    (membership.role === "OWNER" || (membership.role === "TECHNICIAN" && assignedToUser));

  function correct(diagnosis: Diagnosis) {
    setSupersedesId(diagnosis.id);
    setFinding(diagnosis.finding);
    setRecommendation(diagnosis.recommendation);
    setFieldErrors({});
    setError("");
    setMessage(`Đang tạo bản sửa cho chẩn đoán #${diagnosis.revisionNo}.`);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!finding.trim()) next.finding = "Vui lòng nhập kết luận kỹ thuật.";
    else if (finding.trim().length > 10_000) next.finding = "Tối đa 10.000 ký tự.";
    if (!recommendation.trim()) next.recommendation = "Vui lòng nhập hướng xử lý.";
    else if (recommendation.trim().length > 10_000) {
      next.recommendation = "Tối đa 10.000 ký tự.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function publish() {
    if (!validate() || submitting) return;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      await api.createDiagnosis(shopId, order.id, {
        finding: finding.trim(),
        recommendation: recommendation.trim(),
        supersedesId,
      });
      await onReload();
      setFinding("");
      setRecommendation("");
      setSupersedesId(null);
      setMessage("Đã xuất bản chẩn đoán mới.");
    } catch (reason) {
      if (reason instanceof RepairFlowApiError) {
        setFieldErrors(reason.fieldErrors);
        if (reason.code === "CONCURRENT_UPDATE" || reason.code === "REPAIR_ORDER_GUARD_FAILED") {
          await onReload();
          setError("Trạng thái phiếu vừa thay đổi. Nội dung bạn nhập vẫn được giữ lại.");
        } else {
          setError(safeErrorMessage(reason));
        }
      } else {
        setError(safeErrorMessage(reason));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="diagnosis-layout" id="diagnosis-panel" role="tabpanel">
      <article className="workspace-card diagnosis-history">
        <header>
          <p className="eyebrow">Lịch sử bất biến</p>
          <h2>{order.diagnoses.length} bản chẩn đoán</h2>
        </header>
        {order.diagnoses.length ? (
          <ol>
            {order.diagnoses.map((diagnosis) => (
              <li key={diagnosis.id}>
                <div className="diagnosis-title">
                  <strong>Chẩn đoán #{diagnosis.revisionNo}</strong>
                  <time dateTime={diagnosis.createdAt}>
                    {new Date(diagnosis.createdAt).toLocaleString("vi-VN")}
                  </time>
                </div>
                {diagnosis.supersedesId && <small>Bản sửa của một chẩn đoán trước</small>}
                <h3>Kết luận kỹ thuật</h3>
                <p>{diagnosis.finding}</p>
                <h3>Hướng xử lý</h3>
                <p>{diagnosis.recommendation}</p>
                {canPublish && (
                  <button className="text-button" onClick={() => correct(diagnosis)} type="button">
                    Tạo bản sửa từ chẩn đoán #{diagnosis.revisionNo}
                  </button>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty-copy">Chưa có chẩn đoán nào được xuất bản.</p>
        )}
      </article>

      {canPublish && (
        <form
          className="workspace-card diagnosis-form"
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
        >
          <header>
            <p className="eyebrow">{supersedesId ? "Bản sửa" : "Chẩn đoán mới"}</p>
            <h2>Xuất bản kết luận kỹ thuật</h2>
            <p>Sau khi xuất bản, nội dung cũ không thể chỉnh sửa hoặc xóa.</p>
          </header>
          <label className="field" htmlFor="diagnosis-finding">
            <span>Kết luận kỹ thuật</span>
            <textarea
              aria-describedby={fieldErrors.finding ? "diagnosis-finding-error" : undefined}
              id="diagnosis-finding"
              maxLength={10_000}
              onChange={(event) => setFinding(event.target.value)}
              rows={7}
              value={finding}
            />
            {fieldErrors.finding && (
              <small className="field-error" id="diagnosis-finding-error">
                {fieldErrors.finding}
              </small>
            )}
          </label>
          <label className="field" htmlFor="diagnosis-recommendation">
            <span>Hướng xử lý</span>
            <textarea
              aria-describedby={
                fieldErrors.recommendation ? "diagnosis-recommendation-error" : undefined
              }
              id="diagnosis-recommendation"
              maxLength={10_000}
              onChange={(event) => setRecommendation(event.target.value)}
              rows={7}
              value={recommendation}
            />
            {fieldErrors.recommendation && (
              <small className="field-error" id="diagnosis-recommendation-error">
                {fieldErrors.recommendation}
              </small>
            )}
          </label>
          <div className="diagnosis-form-actions">
            {supersedesId && (
              <button
                className="button button-secondary"
                onClick={() => {
                  setSupersedesId(null);
                  setFinding("");
                  setRecommendation("");
                }}
                type="button"
              >
                Hủy bản sửa
              </button>
            )}
            <button className="button button-primary" disabled={submitting} type="submit">
              {submitting ? "Đang xuất bản…" : "Xuất bản chẩn đoán"}
            </button>
          </div>
          {message && (
            <p className="notice notice-success" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
