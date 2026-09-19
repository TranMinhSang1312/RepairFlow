"use client";

import { useEffect, useRef, useState } from "react";

import { RepairFlowApiError, safeErrorMessage } from "@/lib/api/errors";
import { BrowserIntakeApi, type IntakeApi } from "@/lib/api/intake-api";
import type {
  AuthData,
  Customer,
  Device,
  DeviceType,
  Membership,
  NewDevice,
  RepairOrderReceipt,
} from "@/lib/api/types";
import {
  createIdempotencyKey,
  EMPTY_INTAKE_DRAFT,
  toIsoDateTime,
  validateIntakeDraft,
  type IntakeDraft,
  type IntakeFieldErrors,
} from "@/lib/intake/intake-form";

type Step = 1 | 2 | 3 | 4;
type AsyncState = "idle" | "loading" | "success" | "error";

interface UploadItem {
  localId: string;
  file: File;
  state: "presigning" | "uploading" | "complete" | "error";
  mediaAssetId?: string | undefined;
  error?: string | undefined;
}

interface NewIntakeFlowProps {
  api?: IntakeApi;
}

const DEVICE_LABELS: Readonly<Record<DeviceType, string>> = {
  PHONE: "Điện thoại",
  LAPTOP: "Laptop",
  TABLET: "Máy tính bảng",
  OTHER: "Thiết bị khác",
};

const STEPS = [
  [1, "Khách hàng"],
  [2, "Thiết bị"],
  [3, "Tiếp nhận"],
  [4, "Xác nhận"],
] as const;

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="field-error" role="alert">
      {message}
    </p>
  );
}

function StatusBanner({ tone = "error", children }: { tone?: "error" | "info"; children: string }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

function deviceLabel(device: Device): string {
  return `${device.brand} ${device.model}`.trim();
}

function eligibleMemberships(auth: AuthData): Membership[] {
  return auth.user.memberships.filter(
    (membership) =>
      membership.status === "ACTIVE" &&
      (membership.role === "OWNER" || membership.role === "RECEPTIONIST"),
  );
}

export function NewIntakeFlow({ api: suppliedApi }: NewIntakeFlowProps) {
  const [api] = useState<IntakeApi>(() => suppliedApi ?? new BrowserIntakeApi());
  const [authState, setAuthState] = useState<AsyncState>("loading");
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [authError, setAuthError] = useState("");
  const [shopId, setShopId] = useState("");
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<IntakeDraft>(EMPTY_INTAKE_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<IntakeFieldErrors>({});
  const [pageError, setPageError] = useState("");

  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearchState, setCustomerSearchState] = useState<AsyncState>("idle");
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: "", phone: "", email: "" });
  const [customerCreateState, setCustomerCreateState] = useState<AsyncState>("idle");
  const customerIdempotencyKey = useRef(createIdempotencyKey());

  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceListState, setDeviceListState] = useState<AsyncState>("idle");
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [deviceForm, setDeviceForm] = useState<NewDevice>({
    type: "PHONE",
    brand: "",
    model: "",
    color: "",
    serial: "",
    imei: "",
  });
  const [deviceCreateState, setDeviceCreateState] = useState<AsyncState>("idle");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [submitState, setSubmitState] = useState<AsyncState>("idle");
  const [receipt, setReceipt] = useState<RepairOrderReceipt | null>(null);
  const orderIdempotencyKey = useRef(createIdempotencyKey());

  useEffect(() => {
    let active = true;
    void api
      .restoreSession()
      .then((session) => {
        if (!active) return;
        const memberships = eligibleMemberships(session);
        const initialMembership = memberships[0];
        setAuth(session);
        setShopId(initialMembership?.shopId ?? "");
        setDraft({
          ...EMPTY_INTAKE_DRAFT,
          branchId: initialMembership?.branches[0]?.id ?? "",
        });
        setAuthState("success");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAuthError(safeErrorMessage(error));
        setAuthState("error");
      });
    return () => {
      active = false;
    };
  }, [api]);

  const memberships = auth ? eligibleMemberships(auth) : [];
  const activeMembership = memberships.find((membership) => membership.shopId === shopId);

  function clearOperationError() {
    setPageError("");
    setFieldErrors({});
  }

  function resetForShop(nextShopId: string) {
    const nextMembership = memberships.find((membership) => membership.shopId === nextShopId);
    setShopId(nextShopId);
    setStep(1);
    setDraft({
      ...EMPTY_INTAKE_DRAFT,
      branchId: nextMembership?.branches[0]?.id ?? "",
    });
    setCustomers([]);
    setDevices([]);
    setUploads([]);
    setReceipt(null);
    setPageError("");
    setFieldErrors({});
    customerIdempotencyKey.current = createIdempotencyKey();
    orderIdempotencyKey.current = createIdempotencyKey();
  }

  async function searchCustomers(event: React.FormEvent) {
    event.preventDefault();
    clearOperationError();
    if (customerQuery.trim().length < 2) {
      setFieldErrors({ customerQuery: "Nhập ít nhất 2 ký tự tên hoặc số điện thoại." });
      return;
    }
    setCustomerSearchState("loading");
    try {
      setCustomers(await api.searchCustomers(shopId, customerQuery));
      setCustomerSearchState("success");
    } catch (error) {
      setPageError(safeErrorMessage(error));
      setCustomerSearchState("error");
    }
  }

  async function chooseCustomer(customer: Customer) {
    clearOperationError();
    setDraft((current) => ({ ...current, customer, device: null }));
    setStep(2);
    setDeviceListState("loading");
    try {
      setDevices(await api.listDevices(shopId, customer.id));
      setDeviceListState("success");
    } catch (error) {
      setDevices([]);
      setPageError(safeErrorMessage(error));
      setDeviceListState("error");
    }
  }

  async function createCustomer(event: React.FormEvent) {
    event.preventDefault();
    clearOperationError();
    const errors: IntakeFieldErrors = {};
    if (!customerForm.name.trim()) errors.name = "Tên khách hàng là bắt buộc.";
    if (customerForm.phone.trim().length < 8) errors.phone = "Số điện thoại cần ít nhất 8 ký tự.";
    if (customerForm.email && !/^\S+@\S+\.\S+$/.test(customerForm.email))
      errors.email = "Email chưa đúng định dạng.";
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    setCustomerCreateState("loading");
    try {
      const customer = await api.createCustomer(
        shopId,
        {
          name: customerForm.name.trim(),
          phone: customerForm.phone.trim(),
          email: customerForm.email.trim() || null,
        },
        customerIdempotencyKey.current,
      );
      setCustomerCreateState("success");
      await chooseCustomer(customer);
    } catch (error) {
      if (error instanceof RepairFlowApiError) setFieldErrors(error.fieldErrors);
      setPageError(safeErrorMessage(error));
      setCustomerCreateState("error");
    }
  }

  function chooseDevice(device: Device) {
    clearOperationError();
    setDraft((current) => ({ ...current, device }));
    setStep(3);
  }

  async function createDevice(event: React.FormEvent) {
    event.preventDefault();
    clearOperationError();
    if (!draft.customer) return;
    const errors: IntakeFieldErrors = {};
    if (!deviceForm.brand.trim()) errors.brand = "Hãng thiết bị là bắt buộc.";
    if (!deviceForm.model.trim()) errors.model = "Model thiết bị là bắt buộc.";
    if ((deviceForm.imei?.length ?? 0) > 32) errors.imei = "IMEI không được quá 32 ký tự.";
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    setDeviceCreateState("loading");
    try {
      const device = await api.createDevice(shopId, draft.customer.id, {
        ...deviceForm,
        brand: deviceForm.brand.trim(),
        model: deviceForm.model.trim(),
        color: deviceForm.color?.trim() || null,
        serial: deviceForm.serial?.trim() || null,
        imei: deviceForm.imei?.trim() || null,
      });
      setDeviceCreateState("success");
      chooseDevice(device);
    } catch (error) {
      if (error instanceof RepairFlowApiError) setFieldErrors(error.fieldErrors);
      setPageError(safeErrorMessage(error));
      setDeviceCreateState("error");
    }
  }

  function updateUpload(localId: string, update: Partial<UploadItem>) {
    setUploads((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...update } : item)),
    );
  }

  async function uploadOne(item: UploadItem) {
    updateUpload(item.localId, { state: "presigning", error: undefined, mediaAssetId: undefined });
    try {
      const mediaAssetId = await api.uploadIntakeMedia(shopId, item.file, ({ stage }) => {
        updateUpload(item.localId, { state: stage });
      });
      updateUpload(item.localId, { state: "complete", mediaAssetId });
      setDraft((current) => ({
        ...current,
        uploadedMediaIds: [...new Set([...current.uploadedMediaIds, mediaAssetId])],
      }));
      setFieldErrors((current) => ({ ...current, uploadedMediaIds: undefined }));
    } catch (error) {
      updateUpload(item.localId, { state: "error", error: safeErrorMessage(error) });
    }
  }

  function selectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const next: UploadItem[] = [];
    let validationError = "";
    for (const file of files) {
      if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
        validationError = "Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.";
        continue;
      }
      if (file.size > 15_000_000) {
        validationError = "Mỗi ảnh phải nhỏ hơn hoặc bằng 15 MB.";
        continue;
      }
      next.push({
        localId: `${file.name}-${file.lastModified}-${createIdempotencyKey()}`,
        file,
        state: "presigning",
      });
    }
    if (validationError) setFieldErrors((current) => ({ ...current, uploads: validationError }));
    setUploads((current) => [...current, ...next]);
    next.forEach((item) => void uploadOne(item));
    event.target.value = "";
  }

  function removeUpload(item: UploadItem) {
    setUploads((current) => current.filter((candidate) => candidate.localId !== item.localId));
    if (item.mediaAssetId) {
      setDraft((current) => ({
        ...current,
        uploadedMediaIds: current.uploadedMediaIds.filter((id) => id !== item.mediaAssetId),
      }));
    }
  }

  function addAccessory() {
    setDraft((current) => ({
      ...current,
      accessories: [...current.accessories, { name: "", conditionNote: "" }],
    }));
  }

  function updateAccessory(index: number, field: "name" | "conditionNote", value: string) {
    setDraft((current) => ({
      ...current,
      accessories: current.accessories.map((accessory, currentIndex) =>
        currentIndex === index ? { ...accessory, [field]: value } : accessory,
      ),
    }));
  }

  function reviewIntake(event: React.FormEvent) {
    event.preventDefault();
    clearOperationError();
    const completeMedia = uploads.flatMap((item) =>
      item.state === "complete" && item.mediaAssetId ? [item.mediaAssetId] : [],
    );
    const currentDraft = { ...draft, uploadedMediaIds: completeMedia };
    const errors = validateIntakeDraft(currentDraft, activeMembership?.intakePhotoMinimum ?? 1);
    setDraft(currentDraft);
    setFieldErrors(errors);
    if (Object.keys(errors).length === 0) setStep(4);
  }

  async function submitIntake() {
    clearOperationError();
    const errors = validateIntakeDraft(draft, activeMembership?.intakePhotoMinimum ?? 1);
    if (Object.keys(errors).length || !draft.customer || !draft.device) {
      setFieldErrors(errors);
      setStep(3);
      return;
    }
    setSubmitState("loading");
    try {
      const created = await api.createRepairOrder(
        shopId,
        {
          branchId: draft.branchId.trim(),
          customerId: draft.customer.id,
          deviceId: draft.device.id,
          reportedProblem: draft.reportedProblem.trim(),
          intakeCondition: draft.intakeCondition.trim(),
          consentAcknowledged: true,
          priority: draft.priority,
          promisedAt: toIsoDateTime(draft.promisedAt),
          accessories: draft.accessories.map((accessory) => ({
            name: accessory.name.trim(),
            conditionNote: accessory.conditionNote?.trim() || null,
          })),
          mediaAssetIds: draft.uploadedMediaIds,
        },
        orderIdempotencyKey.current,
      );
      setReceipt(created);
      setSubmitState("success");
    } catch (error) {
      if (error instanceof RepairFlowApiError) setFieldErrors(error.fieldErrors);
      setPageError(safeErrorMessage(error));
      setSubmitState("error");
    }
  }

  function startAnotherIntake() {
    const retainedBranchId = draft.branchId;
    setDraft({ ...EMPTY_INTAKE_DRAFT, branchId: retainedBranchId });
    setStep(1);
    setCustomers([]);
    setDevices([]);
    setUploads([]);
    setReceipt(null);
    setSubmitState("idle");
    setPageError("");
    setFieldErrors({});
    setCustomerForm({ name: "", phone: "", email: "" });
    setDeviceForm({ type: "PHONE", brand: "", model: "", color: "", serial: "", imei: "" });
    customerIdempotencyKey.current = createIdempotencyKey();
    orderIdempotencyKey.current = createIdempotencyKey();
  }

  if (authState === "loading") {
    return (
      <main className="intake-shell centered-state" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <h1>Đang khôi phục phiên làm việc</h1>
        <p>RepairFlow đang xác nhận tài khoản và cửa hàng của bạn.</p>
      </main>
    );
  }

  if (authState === "error" || !auth) {
    return (
      <main className="intake-shell centered-state">
        <span className="state-icon">!</span>
        <h1>Chưa thể mở màn hình tiếp nhận</h1>
        <p>{authError || "Vui lòng đăng nhập lại để tiếp tục."}</p>
      </main>
    );
  }

  if (!activeMembership) {
    return (
      <main className="intake-shell centered-state">
        <span className="state-icon">×</span>
        <h1>Không có quyền tạo phiếu</h1>
        <p>Tài khoản cần vai trò chủ cửa hàng hoặc lễ tân đang hoạt động.</p>
      </main>
    );
  }

  if (receipt) {
    return (
      <main className="intake-shell receipt-shell">
        <section className="receipt-card" aria-labelledby="receipt-title">
          <span className="success-mark" aria-hidden="true">
            ✓
          </span>
          <p className="eyebrow">Đã nhận thiết bị</p>
          <h1 id="receipt-title">{receipt.code}</h1>
          <span className="status-badge">RECEIVED</span>
          <dl className="receipt-grid">
            <div>
              <dt>Khách hàng</dt>
              <dd>{receipt.customer.name}</dd>
            </div>
            <div>
              <dt>Thiết bị</dt>
              <dd>{deviceLabel(receipt.device)}</dd>
            </div>
            <div>
              <dt>Tiếp nhận lúc</dt>
              <dd>{new Date(receipt.receivedAt).toLocaleString("vi-VN")}</dd>
            </div>
            <div>
              <dt>Ưu tiên</dt>
              <dd>{receipt.priority}</dd>
            </div>
          </dl>
          <div className="receipt-actions">
            <button className="button button-primary" type="button" onClick={startAnotherIntake}>
              Tạo phiếu tiếp theo
            </button>
            <a className="button button-secondary" href="/">
              Về trang chính
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="intake-shell">
      <header className="staff-header">
        <a className="brand" href="/" aria-label="RepairFlow home">
          <span>R</span> RepairFlow
        </a>
        <label className="shop-selector">
          <span>Cửa hàng</span>
          <select value={shopId} onChange={(event) => resetForShop(event.target.value)}>
            {memberships.map((membership) => (
              <option key={membership.shopId} value={membership.shopId}>
                {membership.shopName}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="intake-heading">
        <div>
          <p className="eyebrow">Tiếp nhận thiết bị</p>
          <h1>Tạo phiếu sửa chữa</h1>
          <p>Ghi lại tình trạng ban đầu rõ ràng trước khi nhận thiết bị.</p>
        </div>
        <div className="operator-chip">
          <span>{auth.user.displayName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{auth.user.displayName}</strong>
            <small>{activeMembership.role === "OWNER" ? "Chủ cửa hàng" : "Lễ tân"}</small>
          </div>
        </div>
      </section>

      <nav className="stepper" aria-label="Các bước tiếp nhận">
        {STEPS.map(([number, label]) => (
          <div
            className={`step ${step === number ? "is-active" : ""} ${step > number ? "is-done" : ""}`}
            key={number}
            aria-current={step === number ? "step" : undefined}
          >
            <span>{step > number ? "✓" : number}</span>
            <small>{label}</small>
          </div>
        ))}
      </nav>

      {pageError ? <StatusBanner>{pageError}</StatusBanner> : null}

      <section className="intake-card">
        {step === 1 ? (
          <div className="step-panel">
            <div className="section-title">
              <span>01</span>
              <div>
                <h2>Khách hàng</h2>
                <p>Tìm bằng số điện thoại hoặc tên để tránh tạo hồ sơ trùng.</p>
              </div>
            </div>
            <form className="search-row" onSubmit={searchCustomers}>
              <label className="field grow">
                <span>Tên hoặc số điện thoại</span>
                <input
                  aria-label="Tên hoặc số điện thoại"
                  value={customerQuery}
                  onChange={(event) => setCustomerQuery(event.target.value)}
                  placeholder="Ví dụ: 0901 234 567"
                />
                <FieldError message={fieldErrors.customerQuery} />
              </label>
              <button
                className="button button-primary search-button"
                disabled={customerSearchState === "loading"}
                type="submit"
              >
                {customerSearchState === "loading" ? "Đang tìm…" : "Tìm khách"}
              </button>
            </form>

            {customers.length ? (
              <div className="selection-list" aria-label="Kết quả khách hàng">
                {customers.map((customer) => (
                  <button
                    className="selection-card"
                    key={customer.id}
                    type="button"
                    onClick={() => void chooseCustomer(customer)}
                  >
                    <span className="avatar">{customer.name.slice(0, 1).toUpperCase()}</span>
                    <span>
                      <strong>{customer.name}</strong>
                      <small>
                        {customer.phone}
                        {customer.email ? ` · ${customer.email}` : ""}
                      </small>
                    </span>
                    <b aria-hidden="true">›</b>
                  </button>
                ))}
              </div>
            ) : customerSearchState === "success" ? (
              <div className="empty-inline">Không tìm thấy khách hàng phù hợp.</div>
            ) : null}

            <div className="divider">
              <span>hoặc</span>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setShowCustomerForm((current) => !current)}
              aria-expanded={showCustomerForm}
            >
              + Tạo khách hàng mới
            </button>

            {showCustomerForm ? (
              <form className="nested-form" onSubmit={createCustomer}>
                <div className="form-grid">
                  <label className="field">
                    <span>Họ tên *</span>
                    <input
                      value={customerForm.name}
                      maxLength={150}
                      onChange={(event) =>
                        setCustomerForm((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                    <FieldError message={fieldErrors.name} />
                  </label>
                  <label className="field">
                    <span>Số điện thoại *</span>
                    <input
                      inputMode="tel"
                      value={customerForm.phone}
                      maxLength={30}
                      onChange={(event) =>
                        setCustomerForm((current) => ({ ...current, phone: event.target.value }))
                      }
                    />
                    <FieldError message={fieldErrors.phone} />
                  </label>
                  <label className="field full-width">
                    <span>Email (không bắt buộc)</span>
                    <input
                      type="email"
                      value={customerForm.email}
                      maxLength={254}
                      onChange={(event) =>
                        setCustomerForm((current) => ({ ...current, email: event.target.value }))
                      }
                    />
                    <FieldError message={fieldErrors.email} />
                  </label>
                </div>
                <button
                  className="button button-primary"
                  disabled={customerCreateState === "loading"}
                  type="submit"
                >
                  {customerCreateState === "loading" ? "Đang tạo…" : "Tạo và chọn khách hàng"}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="step-panel">
            <div className="section-title">
              <span>02</span>
              <div>
                <h2>Thiết bị</h2>
                <p>
                  Thiết bị của <strong>{draft.customer?.name}</strong>
                </p>
              </div>
            </div>
            {deviceListState === "loading" ? (
              <div className="empty-inline">Đang tải danh sách thiết bị…</div>
            ) : devices.length ? (
              <div className="selection-list">
                {devices.map((device) => (
                  <button
                    className="selection-card"
                    key={device.id}
                    type="button"
                    onClick={() => chooseDevice(device)}
                  >
                    <span className="device-icon">▣</span>
                    <span>
                      <strong>{deviceLabel(device)}</strong>
                      <small>
                        {DEVICE_LABELS[device.type]}
                        {device.color ? ` · ${device.color}` : ""}
                        {device.imeiMasked ? ` · IMEI ${device.imeiMasked}` : ""}
                      </small>
                    </span>
                    <b aria-hidden="true">›</b>
                  </button>
                ))}
              </div>
            ) : deviceListState === "success" ? (
              <div className="empty-inline">Khách hàng này chưa có thiết bị.</div>
            ) : null}
            <div className="divider">
              <span>hoặc</span>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setShowDeviceForm((current) => !current)}
              aria-expanded={showDeviceForm}
            >
              + Thêm thiết bị mới
            </button>
            {showDeviceForm ? (
              <form className="nested-form" onSubmit={createDevice}>
                <div className="form-grid">
                  <label className="field">
                    <span>Loại thiết bị *</span>
                    <select
                      value={deviceForm.type}
                      onChange={(event) =>
                        setDeviceForm((current) => ({
                          ...current,
                          type: event.target.value as DeviceType,
                        }))
                      }
                    >
                      {Object.entries(DEVICE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Hãng *</span>
                    <input
                      value={deviceForm.brand}
                      maxLength={100}
                      onChange={(event) =>
                        setDeviceForm((current) => ({ ...current, brand: event.target.value }))
                      }
                    />
                    <FieldError message={fieldErrors.brand} />
                  </label>
                  <label className="field">
                    <span>Model *</span>
                    <input
                      value={deviceForm.model}
                      maxLength={150}
                      onChange={(event) =>
                        setDeviceForm((current) => ({ ...current, model: event.target.value }))
                      }
                    />
                    <FieldError message={fieldErrors.model} />
                  </label>
                  <label className="field">
                    <span>Màu sắc</span>
                    <input
                      value={deviceForm.color ?? ""}
                      maxLength={50}
                      onChange={(event) =>
                        setDeviceForm((current) => ({ ...current, color: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Serial</span>
                    <input
                      value={deviceForm.serial ?? ""}
                      maxLength={100}
                      onChange={(event) =>
                        setDeviceForm((current) => ({ ...current, serial: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>IMEI</span>
                    <input
                      value={deviceForm.imei ?? ""}
                      maxLength={32}
                      onChange={(event) =>
                        setDeviceForm((current) => ({ ...current, imei: event.target.value }))
                      }
                    />
                    <FieldError message={fieldErrors.imei} />
                  </label>
                </div>
                <p className="security-note">RepairFlow không thu thập PIN hoặc mật khẩu mở máy.</p>
                <button
                  className="button button-primary"
                  disabled={deviceCreateState === "loading"}
                  type="submit"
                >
                  {deviceCreateState === "loading" ? "Đang tạo…" : "Tạo và chọn thiết bị"}
                </button>
              </form>
            ) : null}
            <div className="panel-actions">
              <button className="button button-ghost" type="button" onClick={() => setStep(1)}>
                ← Quay lại
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <form className="step-panel" onSubmit={reviewIntake}>
            <div className="section-title">
              <span>03</span>
              <div>
                <h2>Bằng chứng tiếp nhận</h2>
                <p>Thông tin này xuất hiện trong hồ sơ để đối chiếu về sau.</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field full-width">
                <span>Chi nhánh tiếp nhận *</span>
                <select
                  value={draft.branchId}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, branchId: event.target.value }))
                  }
                >
                  {activeMembership.branches.length === 0 ? (
                    <option value="">Chưa có chi nhánh hoạt động</option>
                  ) : null}
                  {activeMembership.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
                <FieldError message={fieldErrors.branchId} />
              </label>
              <label className="field full-width">
                <span>Khách báo lỗi gì? *</span>
                <textarea
                  value={draft.reportedProblem}
                  maxLength={5000}
                  rows={4}
                  placeholder="Mô tả bằng lời của khách hàng"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, reportedProblem: event.target.value }))
                  }
                />
                <small className="customer-visible">Nội dung khách hàng có thể nhìn thấy</small>
                <FieldError message={fieldErrors.reportedProblem} />
              </label>
              <label className="field full-width">
                <span>Tình trạng bên ngoài khi nhận *</span>
                <textarea
                  value={draft.intakeCondition}
                  maxLength={5000}
                  rows={4}
                  placeholder="Ví dụ: xước góc phải, màn hình nứt nhẹ…"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, intakeCondition: event.target.value }))
                  }
                />
                <FieldError message={fieldErrors.intakeCondition} />
              </label>
              <label className="field">
                <span>Mức ưu tiên</span>
                <select
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      priority: event.target.value as IntakeDraft["priority"],
                    }))
                  }
                >
                  <option value="LOW">Thấp</option>
                  <option value="NORMAL">Bình thường</option>
                  <option value="HIGH">Cao</option>
                  <option value="URGENT">Khẩn cấp</option>
                </select>
              </label>
              <label className="field">
                <span>Ngày hẹn dự kiến</span>
                <input
                  type="datetime-local"
                  value={draft.promisedAt}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, promisedAt: event.target.value }))
                  }
                />
                <FieldError message={fieldErrors.promisedAt} />
              </label>
            </div>

            <div className="subsection">
              <div className="subsection-heading">
                <div>
                  <h3>Phụ kiện đi kèm</h3>
                  <p>Ghi riêng từng món để tránh nhầm khi bàn giao.</p>
                </div>
                <button className="text-button" type="button" onClick={addAccessory}>
                  + Thêm phụ kiện
                </button>
              </div>
              {draft.accessories.map((accessory, index) => (
                <div className="accessory-row" key={index}>
                  <label className="field">
                    <span>Tên phụ kiện</span>
                    <input
                      value={accessory.name}
                      maxLength={100}
                      placeholder="Sạc, ốp lưng…"
                      onChange={(event) => updateAccessory(index, "name", event.target.value)}
                    />
                    <FieldError message={fieldErrors[`accessories.${index}.name`]} />
                  </label>
                  <label className="field">
                    <span>Tình trạng</span>
                    <input
                      value={accessory.conditionNote ?? ""}
                      maxLength={500}
                      placeholder="Trầy nhẹ, hoạt động bình thường…"
                      onChange={(event) =>
                        updateAccessory(index, "conditionNote", event.target.value)
                      }
                    />
                  </label>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Xóa phụ kiện ${index + 1}`}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        accessories: current.accessories.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="subsection">
              <div className="subsection-heading">
                <div>
                  <h3>Ảnh hiện trạng *</h3>
                  <p>
                    Tối thiểu {activeMembership.intakePhotoMinimum} ảnh. JPEG, PNG hoặc WebP; tối đa
                    15 MB mỗi ảnh.
                  </p>
                </div>
              </div>
              <label className="upload-zone">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  multiple
                  onChange={selectFiles}
                />
                <span className="upload-icon">＋</span>
                <strong>Chụp hoặc chọn ảnh</strong>
                <small>Ảnh được tải thẳng lên kho riêng tư</small>
              </label>
              <FieldError message={fieldErrors.uploads ?? fieldErrors.uploadedMediaIds} />
              {uploads.length ? (
                <div className="upload-list" aria-live="polite">
                  {uploads.map((item) => (
                    <div className="upload-item" key={item.localId}>
                      <span className={`upload-state upload-state-${item.state}`}>
                        {item.state === "complete" ? "✓" : item.state === "error" ? "!" : "…"}
                      </span>
                      <span>
                        <strong>{item.file.name}</strong>
                        <small>
                          {item.state === "presigning" && "Đang chuẩn bị tải lên"}
                          {item.state === "uploading" && "Đang tải ảnh"}
                          {item.state === "complete" && "Đã tải lên"}
                          {item.state === "error" && item.error}
                        </small>
                      </span>
                      {item.state === "error" ? (
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => void uploadOne(item)}
                        >
                          Thử lại
                        </button>
                      ) : null}
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Xóa ảnh ${item.file.name}`}
                        onClick={() => removeUpload(item)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <label className="consent-box">
              <input
                type="checkbox"
                checked={draft.consentAcknowledged}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    consentAcknowledged: event.target.checked,
                  }))
                }
              />
              <span>
                <strong>Khách hàng đã xác nhận về dữ liệu và sao lưu *</strong>
                <small>
                  Khách hiểu rằng cửa hàng không chịu trách nhiệm cho dữ liệu chưa được sao lưu
                  trước khi sửa chữa.
                </small>
              </span>
            </label>
            <FieldError message={fieldErrors.consentAcknowledged} />

            <div className="panel-actions split-actions">
              <button className="button button-ghost" type="button" onClick={() => setStep(2)}>
                ← Quay lại
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={uploads.some(
                  (item) => item.state === "presigning" || item.state === "uploading",
                )}
              >
                Xem lại phiếu →
              </button>
            </div>
          </form>
        ) : null}

        {step === 4 ? (
          <div className="step-panel">
            <div className="section-title">
              <span>04</span>
              <div>
                <h2>Kiểm tra và xác nhận</h2>
                <p>Đối chiếu lần cuối trước khi cửa hàng nhận giữ thiết bị.</p>
              </div>
            </div>
            <div className="review-grid">
              <section>
                <div className="review-heading">
                  <h3>Khách hàng</h3>
                  <button type="button" onClick={() => setStep(1)}>
                    Sửa
                  </button>
                </div>
                <strong>{draft.customer?.name}</strong>
                <p>{draft.customer?.phone}</p>
              </section>
              <section>
                <div className="review-heading">
                  <h3>Thiết bị</h3>
                  <button type="button" onClick={() => setStep(2)}>
                    Sửa
                  </button>
                </div>
                <strong>{draft.device ? deviceLabel(draft.device) : ""}</strong>
                <p>{draft.device ? DEVICE_LABELS[draft.device.type] : ""}</p>
              </section>
              <section className="full-width">
                <div className="review-heading">
                  <h3>Tình trạng tiếp nhận</h3>
                  <button type="button" onClick={() => setStep(3)}>
                    Sửa
                  </button>
                </div>
                <dl className="review-details">
                  <div>
                    <dt>Lỗi khách báo</dt>
                    <dd>{draft.reportedProblem}</dd>
                  </div>
                  <div>
                    <dt>Ngoại quan</dt>
                    <dd>{draft.intakeCondition}</dd>
                  </div>
                  <div>
                    <dt>Ưu tiên</dt>
                    <dd>{draft.priority}</dd>
                  </div>
                  <div>
                    <dt>Ảnh</dt>
                    <dd>{draft.uploadedMediaIds.length} ảnh đã tải lên</dd>
                  </div>
                  <div>
                    <dt>Phụ kiện</dt>
                    <dd>
                      {draft.accessories.length
                        ? draft.accessories.map((item) => item.name).join(", ")
                        : "Không có"}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
            <div className="binding-note">
              <strong>Khi xác nhận, thiết bị sẽ vào trạng thái RECEIVED</strong>
              <p>Mã phiếu do máy chủ tạo và sự kiện tiếp nhận được lưu vào timeline.</p>
            </div>
            {pageError ? <StatusBanner>{pageError}</StatusBanner> : null}
            <FieldError message={Object.values(fieldErrors).find(Boolean)} />
            <div className="panel-actions split-actions">
              <button className="button button-ghost" type="button" onClick={() => setStep(3)}>
                ← Quay lại
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={submitState === "loading"}
                onClick={() => void submitIntake()}
              >
                {submitState === "loading" ? "Đang tạo phiếu…" : "Xác nhận nhận thiết bị"}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
