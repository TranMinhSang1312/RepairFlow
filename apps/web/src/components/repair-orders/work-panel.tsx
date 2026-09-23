"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { RepairFlowApiError, safeErrorMessage } from "@/lib/api/errors";
import type { RepairOrderWorkspaceApi } from "@/lib/api/intake-api";
import type {
  ApprovedScopeItem,
  CreatePartUsedInput,
  CreateWorkLogInput,
  Membership,
  PartRequirement,
  PartUsed,
  RepairOrderDetail,
  RepairOrderStatus,
  WorkLog,
  WorkLogSemanticType,
} from "@/lib/api/types";

interface WorkPanelProps {
  api: RepairOrderWorkspaceApi;
  membership: Membership;
  order: RepairOrderDetail;
  shopId: string;
  userId: string;
  onReload(): Promise<void>;
  onNavigateQuote(): void;
}

type PreparedCommand = { fingerprint: string; key: string };
type RequirementTarget = "ORDERED" | "AVAILABLE";

const LOG_LABELS: Record<WorkLogSemanticType, string> = {
  REPAIR: "Sửa chữa",
  TEST: "Kiểm tra",
  CUSTOMER_CONTACT: "Trao đổi khách hàng",
  INTERNAL_NOTE: "Ghi chú nội bộ",
};

const REQUIREMENT_LABELS = {
  NEEDED: "Cần linh kiện",
  ORDERED: "Đã đặt",
  AVAILABLE: "Đã sẵn sàng",
  CANCELLED: "Đã hủy khi đối soát phạm vi",
} as const;

const TECHNICAL_STATES: RepairOrderStatus[] = ["REPAIRING"];
const OPERATIONAL_STATES: RepairOrderStatus[] = [
  "APPROVED",
  "WAITING_PARTS",
  "REPAIRING",
  "QUALITY_CHECK",
  "READY_FOR_PICKUP",
];
const REQUIREMENT_STATES: RepairOrderStatus[] = ["APPROVED", "WAITING_PARTS", "REPAIRING"];

function commandKey(current: PreparedCommand | undefined, prefix: string, payload: unknown) {
  const fingerprint = JSON.stringify(payload);
  if (current?.fingerprint === fingerprint) return current;
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return { fingerprint, key: `${prefix}-${random}` };
}

function money(value: number | null): string {
  if (value === null) return "Không ghi nhận";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Không xác định" : date.toLocaleString("vi-VN");
}

function quantity(value: number, unit: "EACH" | "HOUR"): string {
  return `${value.toLocaleString("vi-VN")} ${unit === "HOUR" ? "giờ" : "đơn vị"}`;
}

function availableLogTypes(status: RepairOrderStatus): WorkLogSemanticType[] {
  const result: WorkLogSemanticType[] = [];
  if (TECHNICAL_STATES.includes(status)) result.push("REPAIR", "TEST");
  if (OPERATIONAL_STATES.includes(status)) result.push("CUSTOMER_CONTACT", "INTERNAL_NOTE");
  return result;
}

function canCorrectLog(status: RepairOrderStatus, log: WorkLog): boolean {
  return log.effectiveType === "REPAIR" || log.effectiveType === "TEST"
    ? TECHNICAL_STATES.includes(status)
    : OPERATIONAL_STATES.includes(status);
}

function requirementTargets(requirement: PartRequirement): RequirementTarget[] {
  if (requirement.status === "NEEDED") return ["ORDERED", "AVAILABLE"];
  if (requirement.status === "ORDERED") return ["AVAILABLE"];
  return [];
}

function transitionTargets(
  status: RepairOrderStatus,
): { target: RepairOrderStatus; label: string }[] {
  if (status === "APPROVED") {
    return [
      { target: "REPAIRING", label: "Bắt đầu sửa chữa" },
      { target: "WAITING_PARTS", label: "Chuyển sang chờ linh kiện" },
    ];
  }
  if (status === "WAITING_PARTS") return [{ target: "REPAIRING", label: "Tiếp tục sửa chữa" }];
  if (status === "REPAIRING") return [{ target: "QUALITY_CHECK", label: "Chuyển sang QC" }];
  return [];
}

function scopeLabel(scope: ApprovedScopeItem): string {
  return `${scope.description} · ${scope.scopeKey.slice(0, 8)}`;
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("vi");
}

function sameScopeSemantics(
  current: Pick<
    ApprovedScopeItem,
    "kind" | "description" | "quantity" | "quantityUnit" | "isOptional" | "approvalGroup"
  >,
  prior: Pick<
    ApprovedScopeItem,
    "kind" | "description" | "quantity" | "quantityUnit" | "isOptional" | "approvalGroup"
  >,
): boolean {
  return (
    current.kind === prior.kind &&
    normalizeIdentity(current.description) === normalizeIdentity(prior.description) &&
    current.quantity === prior.quantity &&
    current.quantityUnit === prior.quantityUnit &&
    current.isOptional === prior.isOptional &&
    (current.approvalGroup ? normalizeIdentity(current.approvalGroup) : null) ===
      (prior.approvalGroup ? normalizeIdentity(prior.approvalGroup) : null)
  );
}

function lineageError(order: RepairOrderDetail): string | null {
  const scope = order.approvedScope;
  if (!scope) return null;
  const scopeKeys = new Set<string>();
  const quoteItemIds = new Set<string>();
  for (const item of scope.items) {
    if (scopeKeys.has(item.scopeKey) || quoteItemIds.has(item.quoteItemId)) {
      return "Dữ liệu phạm vi đã duyệt có định danh bị trùng. Các thao tác đã bị khóa.";
    }
    scopeKeys.add(item.scopeKey);
    quoteItemIds.add(item.quoteItemId);
  }

  const approvedQuote = order.quoteVersions.find((quote) => quote.id === scope.quoteVersionId);
  if (!approvedQuote) return "Không tìm thấy phiên bản báo giá nguồn của phạm vi đã duyệt.";
  const allItems = new Map(
    order.quoteVersions.flatMap((quote) => quote.items.map((item) => [item.id, item])),
  );
  const priorItems = order.quoteVersions
    .filter((quote) => quote.versionNo < approvedQuote.versionNo)
    .flatMap((quote) => quote.items);
  const carried = new Set<string>();
  for (const item of approvedQuote.items) {
    if (!quoteItemIds.has(item.id)) continue;
    const approved = scope.items.find((candidate) => candidate.quoteItemId === item.id);
    if (!approved || approved.scopeKey !== item.scopeKey) {
      return "Định danh phạm vi báo giá không khớp snapshot đã duyệt.";
    }
    if (!item.carriedFromQuoteItemId) {
      if (priorItems.some((prior) => prior.scopeKey === item.scopeKey)) {
        return "Hạng mục dùng lại scope cũ nhưng thiếu lineage nguồn tường minh.";
      }
      continue;
    }
    const prior = priorItems.find((candidate) => candidate.id === item.carriedFromQuoteItemId);
    if (
      !prior ||
      prior.id === item.id ||
      prior.scopeKey !== item.scopeKey ||
      !sameScopeSemantics(item, prior)
    ) {
      return "Lineage của hạng mục mang sang bị thiếu, lạ hoặc tạo vòng tham chiếu.";
    }
    if (carried.has(prior.id)) return "Nhiều hạng mục đang mang cùng một lineage nguồn.";
    carried.add(prior.id);
    const visited = new Set([item.id]);
    let cursor = prior;
    while (cursor.carriedFromQuoteItemId) {
      if (visited.has(cursor.id)) return "Lineage của hạng mục tạo vòng tham chiếu.";
      visited.add(cursor.id);
      const next = allItems.get(cursor.carriedFromQuoteItemId);
      if (!next) return "Lineage của hạng mục tham chiếu dữ liệu không còn tồn tại.";
      cursor = next;
    }
  }
  return null;
}

function isNetworkUnknown(error: unknown): boolean {
  return !(error instanceof RepairFlowApiError) || error.status === 0;
}

export function WorkPanel({
  api,
  membership,
  order,
  shopId,
  userId,
  onReload,
  onNavigateQuote,
}: WorkPanelProps) {
  const scope = order.approvedScope;
  const contractError = useMemo(() => lineageError(order), [order]);
  const isAssigned = order.assignedTechnicianUserId === userId;
  const canMutate = membership.role === "OWNER" || (membership.role === "TECHNICIAN" && isAssigned);
  const logTypes = useMemo(() => availableLogTypes(order.status), [order.status]);
  const requirementState = REQUIREMENT_STATES.includes(order.status);
  const partItems = useMemo(
    () => scope?.items.filter((item) => item.kind === "PART") ?? [],
    [scope],
  );
  const technicalItems = useMemo(
    () => scope?.items.filter((item) => item.kind === "PART" || item.kind === "SERVICE") ?? [],
    [scope],
  );

  const [logType, setLogType] = useState<WorkLogSemanticType>(logTypes[0] ?? "INTERNAL_NOTE");
  const [logScopeId, setLogScopeId] = useState(technicalItems[0]?.quoteItemId ?? "");
  const [logContent, setLogContent] = useState("");
  const [correctionLog, setCorrectionLog] = useState<WorkLog | null>(null);
  const [requirementItemId, setRequirementItemId] = useState(partItems[0]?.quoteItemId ?? "");
  const [requirementSku, setRequirementSku] = useState("");
  const [partItemId, setPartItemId] = useState(partItems[0]?.quoteItemId ?? "");
  const [partName, setPartName] = useState("");
  const [partSku, setPartSku] = useState("");
  const [partQuantity, setPartQuantity] = useState("1");
  const [partCost, setPartCost] = useState("");
  const [partSalePrice, setPartSalePrice] = useState("");
  const [correctionPart, setCorrectionPart] = useState<PartUsed | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reviewRequired, setReviewRequired] = useState(false);
  const feedbackRef = useRef<HTMLParagraphElement | null>(null);
  const busyRef = useRef(false);
  const logCommand = useRef<PreparedCommand | undefined>(undefined);
  const requirementCommand = useRef<PreparedCommand | undefined>(undefined);
  const partCommand = useRef<PreparedCommand | undefined>(undefined);
  const requirementUpdates = useRef(new Map<string, PreparedCommand>());
  const transitions = useRef(new Map<string, PreparedCommand>());
  const liveCorrectionLog = correctionLog
    ? order.workLogs.find((item) => item.id === correctionLog.id)
    : null;
  const correctionLogAllowed = correctionLog
    ? Boolean(liveCorrectionLog?.isEffective && canCorrectLog(order.status, liveCorrectionLog))
    : true;
  const liveCorrectionPart = correctionPart
    ? order.partsUsed.find((item) => item.id === correctionPart.id)
    : null;
  const correctionPartAllowed = correctionPart
    ? Boolean(
        order.status === "REPAIRING" &&
        liveCorrectionPart?.isEffective &&
        partItems.some((item) => item.scopeKey === liveCorrectionPart.scopeKey),
      )
    : true;
  useEffect(() => {
    setLogScopeId((current) =>
      technicalItems.some((item) => item.quoteItemId === current)
        ? current
        : (technicalItems[0]?.quoteItemId ?? ""),
    );
    setRequirementItemId((current) =>
      partItems.some((item) => item.quoteItemId === current)
        ? current
        : (partItems[0]?.quoteItemId ?? ""),
    );
    setPartItemId((current) =>
      partItems.some((item) => item.quoteItemId === current)
        ? current
        : (partItems[0]?.quoteItemId ?? ""),
    );
  }, [partItems, technicalItems]);

  useEffect(() => {
    setLogType((current) => (logTypes.includes(current) ? current : (logTypes[0] ?? current)));
  }, [logTypes]);

  function focusFeedback() {
    globalThis.setTimeout(() => feedbackRef.current?.focus(), 0);
  }

  async function handleFailure(
    reason: unknown,
    preserveForConflict = false,
    fieldMap: Record<string, string> = {},
  ) {
    const concurrent = reason instanceof RepairFlowApiError && reason.code === "CONCURRENT_UPDATE";
    if (concurrent || isNetworkUnknown(reason)) {
      await onReload().catch(() => undefined);
    }
    if (concurrent && preserveForConflict) {
      setReviewRequired(true);
      setError(
        "Phiếu đã thay đổi. Dữ liệu mới đã được tải; nội dung bạn nhập vẫn được giữ. Hãy xem lại trước khi thử lại.",
      );
    } else if (isNetworkUnknown(reason)) {
      setError(
        "Kết quả thao tác chưa xác định. Lịch sử đã được tải lại; hãy kiểm tra trước khi thử lại.",
      );
    } else {
      setError(safeErrorMessage(reason));
      if (reason instanceof RepairFlowApiError) {
        setFieldErrors(
          Object.fromEntries(
            Object.entries(reason.fieldErrors).map(([field, value]) => [
              fieldMap[field] ?? field,
              value,
            ]),
          ),
        );
      }
    }
    focusFeedback();
  }

  async function appendLog() {
    if (busyRef.current || reviewRequired) return;
    const nextErrors: Record<string, string> = {};
    if (!logContent.trim()) nextErrors.logContent = "Nội dung không được để trống.";
    if (logContent.length > 10_000) nextErrors.logContent = "Nội dung tối đa 10.000 ký tự.";
    const effectiveType = correctionLog?.effectiveType ?? logType;
    if (!correctionLogAllowed) {
      nextErrors.logContent =
        "Bản ghi hoặc trạng thái đã thay đổi. Hãy hủy đính chính và chọn bản hiệu lực mới.";
    }
    if ((effectiveType === "REPAIR" || effectiveType === "TEST") && !correctionLog && !logScopeId) {
      nextErrors.logScopeId = "Chọn một hạng mục đã được duyệt.";
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const input: CreateWorkLogInput = correctionLog
      ? { type: "CORRECTION", content: logContent.trim(), supersedesId: correctionLog.id }
      : {
          type: logType,
          content: logContent.trim(),
          ...(logType === "REPAIR" || logType === "TEST" ? { quoteItemId: logScopeId } : {}),
        };
    const prepared = commandKey(logCommand.current, "work-log", input);
    logCommand.current = prepared;
    busyRef.current = true;
    setBusy("log");
    setError("");
    setMessage("");
    try {
      await api.createWorkLog(shopId, order.id, input, prepared.key);
      logCommand.current = undefined;
      setLogContent("");
      setCorrectionLog(null);
      setMessage("Đã ghi nhận nhật ký bất biến và tải lại dữ liệu máy chủ.");
      await onReload();
      focusFeedback();
    } catch (reason) {
      await handleFailure(reason, true, {
        content: "logContent",
        quoteItemId: "logScopeId",
        supersedesId: "logContent",
      });
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function createRequirement() {
    if (busyRef.current || reviewRequired) return;
    const nextErrors: Record<string, string> = {};
    if (!requirementItemId) nextErrors.requirementItemId = "Chọn linh kiện đã được duyệt.";
    if (requirementSku.trim().length > 100) nextErrors.requirementSku = "SKU tối đa 100 ký tự.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const input = { quoteItemId: requirementItemId, sku: requirementSku.trim() || null };
    const prepared = commandKey(requirementCommand.current, "part-requirement", input);
    requirementCommand.current = prepared;
    busyRef.current = true;
    setBusy("requirement-create");
    setError("");
    setMessage("");
    try {
      await api.createPartRequirement(shopId, order.id, input, prepared.key);
      requirementCommand.current = undefined;
      setRequirementSku("");
      setMessage("Đã tạo yêu cầu linh kiện từ phạm vi đã duyệt.");
      await onReload();
      focusFeedback();
    } catch (reason) {
      await handleFailure(reason, true, {
        quoteItemId: "requirementItemId",
        sku: "requirementSku",
      });
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function advanceRequirement(requirement: PartRequirement, targetStatus: RequirementTarget) {
    if (busyRef.current || reviewRequired) return;
    const input = { targetStatus, expectedLockVersion: requirement.lockVersion };
    const key = `${requirement.id}:${targetStatus}`;
    const prepared = commandKey(
      requirementUpdates.current.get(key),
      "part-requirement-update",
      input,
    );
    requirementUpdates.current.set(key, prepared);
    busyRef.current = true;
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await api.updatePartRequirement(shopId, requirement.id, input, prepared.key);
      requirementUpdates.current.delete(key);
      setMessage("Đã cập nhật tình trạng linh kiện theo dữ liệu máy chủ.");
      await onReload();
      focusFeedback();
    } catch (reason) {
      await handleFailure(reason, true);
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function appendPart() {
    if (busyRef.current || reviewRequired) return;
    const nextErrors: Record<string, string> = {};
    const parsedQuantity = Number(partQuantity);
    const parsedCost = partCost === "" ? null : Number(partCost);
    const parsedSalePrice = partSalePrice === "" ? null : Number(partSalePrice);
    if (!partItemId) nextErrors.partItemId = "Chọn linh kiện đã được duyệt.";
    if (!correctionPartAllowed) {
      nextErrors.partItemId =
        "Snapshot hoặc phạm vi đã thay đổi. Hãy hủy đính chính và chọn bản hiệu lực mới.";
    }
    if (!partName.trim()) nextErrors.partName = "Tên linh kiện không được để trống.";
    if (partName.trim().length > 300) nextErrors.partName = "Tên tối đa 300 ký tự.";
    if (partSku.trim().length > 100) nextErrors.partSku = "SKU tối đa 100 ký tự.";
    if (
      !Number.isFinite(parsedQuantity) ||
      parsedQuantity <= 0 ||
      parsedQuantity > 9_999_999_999.99 ||
      !/^\d+(\.\d{1,2})?$/.test(partQuantity)
    ) {
      nextErrors.partQuantity = "Số lượng phải lớn hơn 0 và có tối đa 2 chữ số thập phân.";
    }
    if (parsedCost !== null && (!Number.isSafeInteger(parsedCost) || parsedCost < 0)) {
      nextErrors.partCost = "Giá vốn phải là số nguyên VND không âm.";
    }
    if (
      parsedSalePrice !== null &&
      (!Number.isSafeInteger(parsedSalePrice) || parsedSalePrice < 0)
    ) {
      nextErrors.partSalePrice = "Giá bán phải là số nguyên VND không âm.";
    }
    const approvedPart = partItems.find((item) => item.quoteItemId === partItemId);
    if (parsedSalePrice !== null && approvedPart && parsedSalePrice !== approvedPart.unitPrice) {
      nextErrors.partSalePrice = `Giá bán phải khớp đơn giá đã duyệt ${money(approvedPart.unitPrice)}.`;
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const input: CreatePartUsedInput = {
      quoteItemId: partItemId,
      name: partName.trim(),
      sku: partSku.trim() || null,
      quantity: parsedQuantity,
      unitCost: parsedCost,
      unitSalePrice: parsedSalePrice,
      ...(correctionPart ? { supersedesId: correctionPart.id } : {}),
    };
    const prepared = commandKey(partCommand.current, "part-used", input);
    partCommand.current = prepared;
    busyRef.current = true;
    setBusy("part");
    setError("");
    setMessage("");
    try {
      await api.createPartUsed(shopId, order.id, input, prepared.key);
      partCommand.current = undefined;
      setPartName("");
      setPartSku("");
      setPartQuantity("1");
      setPartCost("");
      setPartSalePrice("");
      setCorrectionPart(null);
      setMessage("Đã ghi nhận snapshot linh kiện và tải lại dữ liệu máy chủ.");
      await onReload();
      focusFeedback();
    } catch (reason) {
      await handleFailure(reason, true, {
        quoteItemId: "partItemId",
        name: "partName",
        sku: "partSku",
        quantity: "partQuantity",
        unitCost: "partCost",
        unitSalePrice: "partSalePrice",
        supersedesId: "partItemId",
      });
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function requestTransition(targetStatus: RepairOrderStatus) {
    if (busyRef.current || reviewRequired) return;
    const input = { targetStatus, expectedLockVersion: order.lockVersion };
    const prepared = commandKey(transitions.current.get(targetStatus), "work-transition", input);
    transitions.current.set(targetStatus, prepared);
    busyRef.current = true;
    setBusy(`transition:${targetStatus}`);
    setError("");
    setMessage("");
    try {
      await api.transitionRepairOrder(shopId, order.id, input, prepared.key);
      transitions.current.delete(targetStatus);
      setMessage("Máy chủ đã xác nhận trạng thái mới của phiếu.");
      await onReload();
      focusFeedback();
    } catch (reason) {
      await handleFailure(reason, true);
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  const activeRequirementScopeKeys = new Set(
    order.partRequirements
      .filter((item) => item.status !== "CANCELLED")
      .map((item) => item.scopeKey),
  );
  const requirementChoices = partItems.filter(
    (item) => !activeRequirementScopeKeys.has(item.scopeKey),
  );
  const canShowMutations = canMutate && Boolean(scope?.items.length) && !contractError;
  const waitingPartsIncomplete = order.partRequirements.some(
    (item) => item.status !== "CANCELLED" && item.status !== "AVAILABLE",
  );

  return (
    <section className="work-panel" aria-label="Công việc sửa chữa">
      <article className="workspace-card work-scope-card">
        <header className="work-section-header">
          <div>
            <p className="eyebrow">Phạm vi có thẩm quyền</p>
            <h2>Hạng mục khách hàng đã duyệt</h2>
          </div>
          {scope && <strong>{money(scope.approvedTotal)}</strong>}
        </header>
        {contractError && (
          <p className="notice notice-error" role="alert">
            {contractError}
          </p>
        )}
        {!scope ? (
          <p className="empty-copy">Chưa có phạm vi được khách hàng duyệt.</p>
        ) : scope.items.length === 0 ? (
          <p className="empty-copy">Snapshot được duyệt chưa có hạng mục.</p>
        ) : (
          <ul className="work-scope-list">
            {scope.items.map((item) => {
              const effectiveEvidence = order.workLogs.filter(
                (log) => log.isEffective && log.scopeKey === item.scopeKey,
              ).length;
              return (
                <li key={item.quoteItemId}>
                  <div>
                    <strong>{item.description}</strong>
                    <small>
                      Scope {item.scopeKey} · {item.kind}
                    </small>
                    {item.displayNote && <p>{item.displayNote}</p>}
                  </div>
                  <div className="work-scope-metrics">
                    <span>{quantity(item.quantity, item.quantityUnit)}</span>
                    <span>{money(item.lineTotal)}</span>
                    <span>{effectiveEvidence} bằng chứng hiện hành</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="binding-note">
          Máy chủ quyết định phạm vi, coverage, tiền và điều kiện chuyển trạng thái.
        </p>
        <button className="button button-secondary" onClick={onNavigateQuote} type="button">
          Phạm vi hoặc giá thay đổi — tạo báo giá mới
        </button>
      </article>

      {membership.role === "RECEPTIONIST" && (
        <p className="notice notice-info">
          Bạn có quyền xem. Các thao tác sửa chữa và linh kiện dành cho chủ cửa hàng hoặc kỹ thuật
          viên đang được phân công.
        </p>
      )}
      {membership.role === "TECHNICIAN" && !isAssigned && (
        <p className="notice notice-info">
          Phiếu này không được phân công cho tài khoản hiện tại nên các thao tác đã bị khóa.
        </p>
      )}

      {canShowMutations && transitionTargets(order.status).length > 0 && (
        <article className="workspace-card">
          <h2>Trạng thái thực hiện</h2>
          <p>
            Yêu cầu chuyển trạng thái luôn được máy chủ kiểm tra lại bằng lock version hiện tại.
          </p>
          <div className="work-actions">
            {transitionTargets(order.status).map((action) => (
              <button
                className="button button-primary"
                disabled={
                  Boolean(busy) ||
                  Boolean(contractError) ||
                  reviewRequired ||
                  (order.status === "WAITING_PARTS" &&
                    action.target === "REPAIRING" &&
                    waitingPartsIncomplete)
                }
                key={action.target}
                onClick={() => void requestTransition(action.target)}
                type="button"
              >
                {busy === `transition:${action.target}` ? "Đang xử lý…" : action.label}
              </button>
            ))}
          </div>
          {order.status === "WAITING_PARTS" && waitingPartsIncomplete && (
            <p className="binding-note">
              Snapshot mới nhất còn linh kiện chưa sẵn sàng. Máy chủ vẫn là nơi quyết định điều kiện
              tiếp tục sửa chữa.
            </p>
          )}
        </article>
      )}

      <div className="work-grid">
        <article className="workspace-card">
          <h2>Nhật ký công việc</h2>
          {order.workLogs.length === 0 ? (
            <p className="empty-copy">Chưa có nhật ký công việc.</p>
          ) : (
            <ol className="work-history-list">
              {order.workLogs.map((log) => (
                <li className={!log.isEffective ? "history-superseded" : ""} key={log.id}>
                  <div className="work-history-heading">
                    <strong>
                      {log.type === "CORRECTION"
                        ? `Đính chính · ${LOG_LABELS[log.effectiveType]}`
                        : LOG_LABELS[log.effectiveType]}
                    </strong>
                    <time>{dateTime(log.createdAt)}</time>
                  </div>
                  <p>{log.content}</p>
                  <small>
                    {log.scopeKey ? `Scope ${log.scopeKey}` : "Nhật ký vận hành"}
                    {log.supersedesId ? ` · thay thế ${log.supersedesId}` : ""}
                    {!log.isEffective ? " · đã được đính chính" : ""}
                  </small>
                  {canShowMutations && log.isEffective && canCorrectLog(order.status, log) && (
                    <button
                      className="button button-secondary"
                      disabled={reviewRequired}
                      onClick={() => {
                        setCorrectionLog(log);
                        setLogContent("");
                      }}
                      type="button"
                    >
                      Đính chính bản ghi này
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </article>

        {canShowMutations && logTypes.length > 0 && (
          <form
            className="workspace-card"
            onSubmit={(event) => {
              event.preventDefault();
              void appendLog();
            }}
          >
            <h2>{correctionLog ? "Thêm bản đính chính" : "Ghi nhật ký"}</h2>
            {correctionLog ? (
              correctionLogAllowed ? (
                <p className="notice notice-info">
                  Bản mới sẽ supersede bản {correctionLog.id}; bản gốc vẫn được giữ nguyên.
                </p>
              ) : (
                <p className="notice notice-error" role="alert">
                  Bản ghi hoặc trạng thái đã thay đổi. Hãy hủy và chọn bản hiệu lực mới.
                </p>
              )
            ) : (
              <label className="field">
                <span>Loại nhật ký</span>
                <select
                  onChange={(event) => setLogType(event.target.value as WorkLogSemanticType)}
                  value={logType}
                >
                  {logTypes.map((type) => (
                    <option key={type} value={type}>
                      {LOG_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!correctionLog && (logType === "REPAIR" || logType === "TEST") && (
              <label className="field">
                <span>Hạng mục đã duyệt</span>
                <select onChange={(event) => setLogScopeId(event.target.value)} value={logScopeId}>
                  <option value="">Chọn hạng mục</option>
                  {technicalItems.map((item) => (
                    <option key={item.quoteItemId} value={item.quoteItemId}>
                      {scopeLabel(item)}
                    </option>
                  ))}
                </select>
                {fieldErrors.logScopeId && (
                  <small className="field-error">{fieldErrors.logScopeId}</small>
                )}
              </label>
            )}
            <label className="field">
              <span>Nội dung</span>
              <textarea
                maxLength={10_000}
                onChange={(event) => setLogContent(event.target.value)}
                rows={5}
                value={logContent}
              />
              {fieldErrors.logContent && (
                <small className="field-error">{fieldErrors.logContent}</small>
              )}
            </label>
            <div className="work-actions">
              <button
                className="button button-primary"
                disabled={Boolean(busy) || reviewRequired || !correctionLogAllowed}
                type="submit"
              >
                {busy === "log" ? "Đang ghi…" : correctionLog ? "Lưu đính chính" : "Ghi nhật ký"}
              </button>
              {correctionLog && (
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setCorrectionLog(null);
                    setLogContent("");
                  }}
                  type="button"
                >
                  Hủy
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      <div className="work-grid">
        <article className="workspace-card">
          <h2>Yêu cầu linh kiện</h2>
          {order.partRequirements.length === 0 ? (
            <p className="empty-copy">Chưa có yêu cầu linh kiện.</p>
          ) : (
            <ul className="part-history-list">
              {order.partRequirements.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.nameSnapshot}</strong>
                    <small>
                      {item.sku || "Không có SKU"} · {quantity(item.quantity, item.quantityUnit)}
                    </small>
                  </div>
                  <span className={`status-pill status-${item.status.toLowerCase()}`}>
                    {REQUIREMENT_LABELS[item.status]}
                  </span>
                  {canShowMutations && requirementState && requirementTargets(item).length > 0 && (
                    <div className="work-actions">
                      {requirementTargets(item).map((target) => (
                        <button
                          className="button button-secondary"
                          disabled={Boolean(busy) || reviewRequired}
                          key={target}
                          onClick={() => void advanceRequirement(item, target)}
                          type="button"
                        >
                          {busy === `${item.id}:${target}`
                            ? "Đang cập nhật…"
                            : target === "ORDERED"
                              ? "Đánh dấu đã đặt"
                              : "Đánh dấu sẵn sàng"}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>

        {canShowMutations && requirementState && requirementChoices.length > 0 && (
          <form
            className="workspace-card"
            onSubmit={(event) => {
              event.preventDefault();
              void createRequirement();
            }}
          >
            <h2>Tạo yêu cầu linh kiện</h2>
            <label className="field">
              <span>Linh kiện đã duyệt</span>
              <select
                onChange={(event) => setRequirementItemId(event.target.value)}
                value={requirementItemId}
              >
                <option value="">Chọn linh kiện</option>
                {requirementChoices.map((item) => (
                  <option key={item.quoteItemId} value={item.quoteItemId}>
                    {scopeLabel(item)}
                  </option>
                ))}
              </select>
              {fieldErrors.requirementItemId && (
                <small className="field-error">{fieldErrors.requirementItemId}</small>
              )}
            </label>
            <label className="field">
              <span>SKU (không bắt buộc)</span>
              <input
                maxLength={100}
                onChange={(event) => setRequirementSku(event.target.value)}
                value={requirementSku}
              />
              {fieldErrors.requirementSku && (
                <small className="field-error">{fieldErrors.requirementSku}</small>
              )}
            </label>
            <button
              className="button button-primary"
              disabled={Boolean(busy) || reviewRequired}
              type="submit"
            >
              {busy === "requirement-create" ? "Đang tạo…" : "Tạo yêu cầu"}
            </button>
          </form>
        )}
      </div>

      <div className="work-grid">
        <article className="workspace-card">
          <h2>Linh kiện đã dùng</h2>
          {order.partsUsed.length === 0 ? (
            <p className="empty-copy">Chưa ghi nhận linh kiện đã dùng.</p>
          ) : (
            <ol className="part-history-list">
              {order.partsUsed.map((item) => {
                const cumulative = order.partsUsed
                  .filter((part) => part.isEffective && part.scopeKey === item.scopeKey)
                  .reduce((sum, part) => sum + part.quantity, 0);
                const approvedQuantity = partItems.find(
                  (part) => part.scopeKey === item.scopeKey,
                )?.quantity;
                return (
                  <li className={!item.isEffective ? "history-superseded" : ""} key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {item.sku || "Không có SKU"} · {item.quantity.toLocaleString("vi-VN")} · Giá
                        vốn {money(item.unitCost)} · Giá bán {money(item.unitSalePrice)}
                      </small>
                      <small>
                        Scope {item.scopeKey} · tổng hiệu lực {cumulative.toLocaleString("vi-VN")}
                        {approvedQuantity === undefined
                          ? " · scope không còn trong snapshot hiện tại"
                          : ` / đã duyệt ${approvedQuantity.toLocaleString("vi-VN")}`}
                        {item.supersedesId ? ` · thay thế ${item.supersedesId}` : ""}
                      </small>
                    </div>
                    {canShowMutations && order.status === "REPAIRING" && item.isEffective && (
                      <button
                        className="button button-secondary"
                        disabled={reviewRequired}
                        onClick={() => {
                          setCorrectionPart(item);
                          setPartItemId(item.quoteItemId);
                          setPartName(item.name);
                          setPartSku(item.sku ?? "");
                          setPartQuantity(String(item.quantity));
                          setPartCost(item.unitCost === null ? "" : String(item.unitCost));
                          setPartSalePrice(
                            item.unitSalePrice === null ? "" : String(item.unitSalePrice),
                          );
                        }}
                        type="button"
                      >
                        Đính chính snapshot
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </article>

        {canShowMutations && order.status === "REPAIRING" && partItems.length > 0 && (
          <form
            className="workspace-card"
            onSubmit={(event) => {
              event.preventDefault();
              void appendPart();
            }}
          >
            <h2>
              {correctionPart ? "Đính chính linh kiện đã dùng" : "Ghi nhận linh kiện đã dùng"}
            </h2>
            {correctionPart &&
              (correctionPartAllowed ? (
                <p className="notice notice-info">
                  Bản gốc {correctionPart.id} vẫn được giữ trong lịch sử.
                </p>
              ) : (
                <p className="notice notice-error" role="alert">
                  Snapshot hoặc phạm vi đã thay đổi. Hãy hủy và chọn bản hiệu lực mới.
                </p>
              ))}
            <label className="field">
              <span>Linh kiện đã duyệt</span>
              <select
                disabled={Boolean(correctionPart)}
                onChange={(event) => setPartItemId(event.target.value)}
                value={partItemId}
              >
                <option value="">Chọn linh kiện</option>
                {partItems.map((item) => (
                  <option key={item.quoteItemId} value={item.quoteItemId}>
                    {scopeLabel(item)}
                  </option>
                ))}
              </select>
              {fieldErrors.partItemId && (
                <small className="field-error">{fieldErrors.partItemId}</small>
              )}
            </label>
            <label className="field">
              <span>Tên snapshot</span>
              <input
                maxLength={300}
                onChange={(event) => setPartName(event.target.value)}
                value={partName}
              />
              {fieldErrors.partName && (
                <small className="field-error">{fieldErrors.partName}</small>
              )}
            </label>
            <label className="field">
              <span>SKU</span>
              <input
                maxLength={100}
                onChange={(event) => setPartSku(event.target.value)}
                value={partSku}
              />
              {fieldErrors.partSku && <small className="field-error">{fieldErrors.partSku}</small>}
            </label>
            <div className="work-form-row">
              <label className="field">
                <span>Số lượng</span>
                <input
                  inputMode="decimal"
                  min="0.01"
                  onChange={(event) => setPartQuantity(event.target.value)}
                  step="0.01"
                  type="number"
                  value={partQuantity}
                />
                {fieldErrors.partQuantity && (
                  <small className="field-error">{fieldErrors.partQuantity}</small>
                )}
              </label>
              <label className="field">
                <span>Giá vốn VND</span>
                <input
                  inputMode="numeric"
                  min="0"
                  onChange={(event) => setPartCost(event.target.value)}
                  step="1"
                  type="number"
                  value={partCost}
                />
                {fieldErrors.partCost && (
                  <small className="field-error">{fieldErrors.partCost}</small>
                )}
              </label>
              <label className="field">
                <span>Giá bán VND</span>
                <input
                  inputMode="numeric"
                  min="0"
                  onChange={(event) => setPartSalePrice(event.target.value)}
                  step="1"
                  type="number"
                  value={partSalePrice}
                />
                {fieldErrors.partSalePrice && (
                  <small className="field-error">{fieldErrors.partSalePrice}</small>
                )}
              </label>
            </div>
            <div className="work-actions">
              <button
                className="button button-primary"
                disabled={Boolean(busy) || reviewRequired || !correctionPartAllowed}
                type="submit"
              >
                {busy === "part" ? "Đang ghi…" : correctionPart ? "Lưu đính chính" : "Ghi nhận"}
              </button>
              {correctionPart && (
                <button
                  className="button button-secondary"
                  onClick={() => setCorrectionPart(null)}
                  type="button"
                >
                  Hủy
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {reviewRequired && (
        <div className="notice notice-info" role="status">
          <p>Máy chủ vừa trả về dữ liệu mới. Nội dung đang nhập được giữ lại.</p>
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
      {message && (
        <p className="notice notice-success" ref={feedbackRef} role="status" tabIndex={-1}>
          {message}
        </p>
      )}
      {error && (
        <p className="notice notice-error" ref={feedbackRef} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
    </section>
  );
}
