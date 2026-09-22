"use client";

import { useEffect, useState } from "react";

import { RepairFlowApiError, safeErrorMessage } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type { ActiveTechnician, Membership, RepairOrderDetail } from "@/lib/api/types";

interface RepairOrderActionsProps {
  api: RepairOrderWorkspaceApi;
  membership: Membership;
  order: RepairOrderDetail;
  shopId: string;
  technicians: ActiveTechnician[];
  onReload(): Promise<void>;
}

function idempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `transition-${Date.now()}-${Math.random()}`;
}

export function RepairOrderActions({
  api,
  membership,
  order,
  shopId,
  technicians,
  onReload,
}: RepairOrderActionsProps) {
  const [technicianUserId, setTechnicianUserId] = useState(
    order.activeAssignment?.technicianUserId ?? "",
  );
  const [busy, setBusy] = useState<"assignment" | "transition" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setTechnicianUserId(order.activeAssignment?.technicianUserId ?? "");
  }, [order.activeAssignment?.technicianUserId]);

  const canAssign = membership.role === "OWNER" || membership.role === "RECEPTIONIST";
  const canStartDiagnosis =
    membership.role === "OWNER" &&
    order.status === "RECEIVED" &&
    Boolean(order.activeAssignment) &&
    Boolean(order.intakeCondition.trim()) &&
    order.media.filter((asset) => asset.purpose === "INTAKE" && asset.uploadedAt).length >=
      membership.intakePhotoMinimum;

  async function assign() {
    if (!technicianUserId || busy) return;
    setBusy("assignment");
    setMessage("");
    setError("");
    try {
      await api.assignTechnician(shopId, order.id, technicianUserId);
      await onReload();
      setMessage("Đã cập nhật kỹ thuật viên phụ trách.");
    } catch (reason) {
      setError(safeErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function startDiagnosis() {
    if (busy) return;
    setBusy("transition");
    setMessage("");
    setError("");
    try {
      await api.transitionRepairOrder(
        shopId,
        order.id,
        { targetStatus: "DIAGNOSING", expectedLockVersion: order.lockVersion },
        idempotencyKey(),
      );
      await onReload();
      setMessage("Phiếu đã chuyển sang trạng thái đang kiểm tra.");
    } catch (reason) {
      if (reason instanceof RepairFlowApiError && reason.code === "CONCURRENT_UPDATE") {
        await onReload();
        setError("Phiếu vừa được người khác cập nhật. Dữ liệu mới nhất đã được tải lại.");
      } else {
        setError(safeErrorMessage(reason));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="workspace-card full-card assignment-card">
      <header>
        <p className="eyebrow">Điều phối kỹ thuật</p>
        <h2>Phân công và bắt đầu chẩn đoán</h2>
      </header>

      <div className="assignment-summary">
        <div>
          <span>Kỹ thuật viên hiện tại</span>
          <strong>
            {order.activeAssignment?.technicianDisplayName ?? "Chưa có người phụ trách"}
          </strong>
          {order.activeAssignment && (
            <small>
              Phân công lúc {new Date(order.activeAssignment.assignedAt).toLocaleString("vi-VN")}
            </small>
          )}
        </div>

        {canAssign && (
          <div className="assignment-controls">
            <label className="field" htmlFor="technician-user-id">
              <span>Kỹ thuật viên hoạt động</span>
              <select
                id="technician-user-id"
                value={technicianUserId}
                onChange={(event) => setTechnicianUserId(event.target.value)}
              >
                <option value="">Chọn kỹ thuật viên</option>
                {technicians.map((technician) => (
                  <option key={technician.userId} value={technician.userId}>
                    {technician.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary"
              disabled={!technicianUserId || busy !== null}
              onClick={() => void assign()}
              type="button"
            >
              {busy === "assignment"
                ? "Đang lưu…"
                : order.activeAssignment
                  ? "Phân công lại"
                  : "Phân công"}
            </button>
          </div>
        )}
      </div>

      {canStartDiagnosis && (
        <button
          className="button button-primary workspace-primary-action"
          disabled={busy !== null}
          onClick={() => void startDiagnosis()}
          type="button"
        >
          {busy === "transition" ? "Đang cập nhật…" : "Bắt đầu chẩn đoán"}
        </button>
      )}
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
    </article>
  );
}
