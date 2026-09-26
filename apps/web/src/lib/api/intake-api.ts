import { apiErrorFromResponse, RepairFlowApiError } from "./errors";
import type {
  AuthData,
  CreateRepairOrderInput,
  Customer,
  Device,
  NewCustomer,
  NewDevice,
  RepairOrderDetail,
  RepairOrderFilters,
  RepairOrderPage,
  RepairOrderReceipt,
  LoginInput,
  RegisterOwnerInput,
  CurrentUser,
  ActiveTechnician,
  Assignment,
  CreateDiagnosisInput,
  Diagnosis,
  CreateQuoteInput,
  Quote,
  QuoteSendChannel,
  SendQuoteResult,
  RepairOrderStatus,
  RepairOrderSummary,
  CreateWorkLogInput,
  WorkLog,
  CreatePartRequirementInput,
  UpdatePartRequirementInput,
  PartRequirement,
  CreatePartUsedInput,
  PartUsed,
  CompletionOutcome,
  CreateQcRunInput,
  CreateQcTemplateInput,
  QcRunSubmissionResult,
  QcTemplate,
  CompleteHandoverInput,
  CreatePaymentInput,
  CreateWarrantyFollowUpInput,
  HandoverResult,
  PaymentResult,
} from "./types";

interface DataResponse<T> {
  data: T;
}

interface CustomerPage extends DataResponse<Customer[]> {
  meta: { nextCursor: string | null };
}

export interface UploadProgress {
  stage: "presigning" | "uploading" | "complete";
}

export interface IntakeApi {
  restoreSession(): Promise<AuthData>;
  searchCustomers(shopId: string, query: string): Promise<Customer[]>;
  createCustomer(shopId: string, input: NewCustomer, idempotencyKey: string): Promise<Customer>;
  listDevices(shopId: string, customerId: string): Promise<Device[]>;
  createDevice(shopId: string, customerId: string, input: NewDevice): Promise<Device>;
  uploadIntakeMedia(
    shopId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<string>;
  createRepairOrder(
    shopId: string,
    input: CreateRepairOrderInput,
    idempotencyKey: string,
  ): Promise<RepairOrderReceipt>;
}

export interface RepairOrderReadApi {
  restoreSession(): Promise<AuthData>;
  listRepairOrders(
    shopId: string,
    filters: RepairOrderFilters,
    cursor?: string,
  ): Promise<RepairOrderPage>;
  getRepairOrder(shopId: string, repairOrderId: string): Promise<RepairOrderDetail>;
}

export interface RepairOrderWorkspaceApi extends RepairOrderReadApi {
  uploadIntakeMedia(
    shopId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<string>;
  listTechnicians(shopId: string): Promise<ActiveTechnician[]>;
  assignTechnician(
    shopId: string,
    repairOrderId: string,
    technicianUserId: string,
  ): Promise<Assignment>;
  transitionRepairOrder(
    shopId: string,
    repairOrderId: string,
    input: {
      targetStatus: RepairOrderStatus;
      expectedLockVersion: number;
      completionOutcome?: CompletionOutcome | null;
      reason?: string | null;
    },
    idempotencyKey: string,
  ): Promise<RepairOrderSummary>;
  createDiagnosis(
    shopId: string,
    repairOrderId: string,
    input: CreateDiagnosisInput,
  ): Promise<Diagnosis>;
  createQuote(shopId: string, repairOrderId: string, input: CreateQuoteInput): Promise<Quote>;
  replaceDraftQuote(
    shopId: string,
    quoteVersionId: string,
    input: CreateQuoteInput,
  ): Promise<Quote>;
  sendQuote(
    shopId: string,
    quoteVersionId: string,
    channel: QuoteSendChannel,
    idempotencyKey: string,
  ): Promise<SendQuoteResult>;
  createWorkLog(
    shopId: string,
    repairOrderId: string,
    input: CreateWorkLogInput,
    idempotencyKey: string,
  ): Promise<WorkLog>;
  createPartRequirement(
    shopId: string,
    repairOrderId: string,
    input: CreatePartRequirementInput,
    idempotencyKey: string,
  ): Promise<PartRequirement>;
  updatePartRequirement(
    shopId: string,
    partRequirementId: string,
    input: UpdatePartRequirementInput,
    idempotencyKey: string,
  ): Promise<PartRequirement>;
  createPartUsed(
    shopId: string,
    repairOrderId: string,
    input: CreatePartUsedInput,
    idempotencyKey: string,
  ): Promise<PartUsed>;
  listQcTemplates(shopId: string, includeInactive?: boolean): Promise<QcTemplate[]>;
  createQcTemplate(
    shopId: string,
    input: CreateQcTemplateInput,
    idempotencyKey: string,
  ): Promise<QcTemplate>;
  deactivateQcTemplate(
    shopId: string,
    qcTemplateId: string,
    idempotencyKey: string,
  ): Promise<QcTemplate>;
  uploadQcEvidence(
    shopId: string,
    repairOrderId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<string>;
  submitQcRun(
    shopId: string,
    repairOrderId: string,
    input: CreateQcRunInput,
    idempotencyKey: string,
  ): Promise<QcRunSubmissionResult>;
  createPayment(
    shopId: string,
    repairOrderId: string,
    input: CreatePaymentInput,
    idempotencyKey: string,
  ): Promise<PaymentResult>;
  uploadHandoverEvidence(
    shopId: string,
    repairOrderId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<string>;
  completeHandover(
    shopId: string,
    repairOrderId: string,
    input: CompleteHandoverInput,
    idempotencyKey: string,
  ): Promise<HandoverResult>;
  createWarrantyFollowUp(
    shopId: string,
    sourceOrderId: string,
    input: CreateWarrantyFollowUpInput,
    idempotencyKey: string,
  ): Promise<RepairOrderDetail>;
}

export interface AuthApi {
  restoreSession(): Promise<AuthData>;
  login(input: LoginInput): Promise<AuthData>;
  registerOwner(input: RegisterOwnerInput): Promise<AuthData>;
  logout(): Promise<void>;
  getMe(): Promise<CurrentUser>;
}

export interface SessionCallbacks {
  onSession?(auth: AuthData): void;
  onSessionExpired?(): void;
}

type RequestOptions = RequestInit & {
  shopId?: string;
  idempotencyKey?: string;
  retryAuth?: boolean;
};

export class BrowserIntakeApi implements IntakeApi, RepairOrderWorkspaceApi {
  private accessToken: string | null = null;
  private refreshPromise: Promise<AuthData> | null = null;

  constructor(
    private readonly baseUrl = "/api/v1",
    private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly callbacks: SessionCallbacks = {},
  ) {}

  restoreSession(): Promise<AuthData> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<AuthData> {
    const response = await this.fetcher.call(globalThis, `${this.baseUrl}/auth/refresh`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw await apiErrorFromResponse(response);
    const body = (await response.json()) as DataResponse<AuthData>;
    this.accessToken = body.data.accessToken;
    this.callbacks.onSession?.(body.data);
    return body.data;
  }

  async login(input: LoginInput): Promise<AuthData> {
    return this.authenticate("/auth/login", input);
  }

  async registerOwner(input: RegisterOwnerInput): Promise<AuthData> {
    return this.authenticate("/auth/register-owner", input);
  }

  private async authenticate(path: string, input: LoginInput | RegisterOwnerInput) {
    const response = await this.fetcher.call(globalThis, `${this.baseUrl}${path}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw await apiErrorFromResponse(response);
    const body = (await response.json()) as DataResponse<AuthData>;
    this.accessToken = body.data.accessToken;
    this.callbacks.onSession?.(body.data);
    return body.data;
  }

  async getMe(): Promise<CurrentUser> {
    const response = await this.request<DataResponse<CurrentUser>>("/me");
    return response.data;
  }

  async logout(): Promise<void> {
    try {
      await this.request<void>("/auth/logout", { method: "POST" });
    } catch (error) {
      if (!(error instanceof RepairFlowApiError) || error.code !== "SESSION_EXPIRED") throw error;
    }
    this.clearSession();
  }

  clearSession(): void {
    this.accessToken = null;
    this.callbacks.onSessionExpired?.();
  }

  async searchCustomers(shopId: string, query: string): Promise<Customer[]> {
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    const suffix = params.size ? `?${params.toString()}` : "";
    const response = await this.request<CustomerPage>(`/customers${suffix}`, { shopId });
    return response.data;
  }

  async createCustomer(
    shopId: string,
    input: NewCustomer,
    idempotencyKey: string,
  ): Promise<Customer> {
    const response = await this.request<DataResponse<Customer>>("/customers", {
      method: "POST",
      shopId,
      idempotencyKey,
      body: JSON.stringify(input),
    });
    return response.data;
  }

  async listDevices(shopId: string, customerId: string): Promise<Device[]> {
    const response = await this.request<DataResponse<Device[]>>(
      `/customers/${encodeURIComponent(customerId)}/devices`,
      { shopId },
    );
    return response.data;
  }

  async createDevice(shopId: string, customerId: string, input: NewDevice): Promise<Device> {
    const response = await this.request<DataResponse<Device>>(
      `/customers/${encodeURIComponent(customerId)}/devices`,
      { method: "POST", shopId, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async uploadIntakeMedia(
    shopId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<string> {
    onProgress?.({ stage: "presigning" });
    const presigned = await this.request<
      DataResponse<{ mediaAssetId: string; uploadUrl: string; expiresAt: string }>
    >("/media/presign", {
      method: "POST",
      shopId,
      body: JSON.stringify({
        purpose: "INTAKE",
        originalName: file.name,
        mimeType: file.type,
        byteSize: file.size,
      }),
    });

    onProgress?.({ stage: "uploading" });
    let upload: Response;
    try {
      upload = await this.fetcher.call(globalThis, presigned.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
    } catch {
      throw new RepairFlowApiError(
        0,
        "MEDIA_UPLOAD_FAILED",
        "Không thể tải ảnh lên. Hãy kiểm tra kết nối và thử lại.",
      );
    }
    if (!upload.ok) {
      throw new RepairFlowApiError(
        upload.status,
        "MEDIA_UPLOAD_FAILED",
        "Không thể tải ảnh lên. Hãy thử lại trước khi tạo phiếu.",
      );
    }
    onProgress?.({ stage: "complete" });
    return presigned.data.mediaAssetId;
  }

  async createRepairOrder(
    shopId: string,
    input: CreateRepairOrderInput,
    idempotencyKey: string,
  ): Promise<RepairOrderReceipt> {
    const response = await this.request<DataResponse<RepairOrderReceipt>>("/repair-orders", {
      method: "POST",
      shopId,
      idempotencyKey,
      body: JSON.stringify(input),
    });
    return response.data;
  }

  async listRepairOrders(
    shopId: string,
    filters: RepairOrderFilters,
    cursor?: string,
  ): Promise<RepairOrderPage> {
    const params = new URLSearchParams();
    const query = filters.query?.trim();
    if (query) params.set("query", query);
    for (const status of filters.statuses ?? []) params.append("status", status);
    if (filters.branchId) params.set("branchId", filters.branchId);
    if (filters.technicianUserId) params.set("technicianUserId", filters.technicianUserId);
    if (cursor) params.set("cursor", cursor);
    const suffix = params.size ? `?${params.toString()}` : "";
    return this.request<RepairOrderPage>(`/repair-orders${suffix}`, { shopId });
  }

  async getRepairOrder(shopId: string, repairOrderId: string): Promise<RepairOrderDetail> {
    const response = await this.request<DataResponse<RepairOrderDetail>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}`,
      { shopId },
    );
    return response.data;
  }

  async listTechnicians(shopId: string): Promise<ActiveTechnician[]> {
    const response = await this.request<DataResponse<ActiveTechnician[]>>("/technicians", {
      shopId,
    });
    return response.data;
  }

  async assignTechnician(
    shopId: string,
    repairOrderId: string,
    technicianUserId: string,
  ): Promise<Assignment> {
    const response = await this.request<DataResponse<Assignment>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}/assignments`,
      { method: "POST", shopId, body: JSON.stringify({ technicianUserId }) },
    );
    return response.data;
  }

  async transitionRepairOrder(
    shopId: string,
    repairOrderId: string,
    input: {
      targetStatus: RepairOrderStatus;
      expectedLockVersion: number;
      completionOutcome?: CompletionOutcome | null;
      reason?: string | null;
    },
    idempotencyKey: string,
  ): Promise<RepairOrderSummary> {
    const response = await this.request<DataResponse<RepairOrderSummary>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}/transition`,
      { method: "POST", shopId, idempotencyKey, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async createDiagnosis(
    shopId: string,
    repairOrderId: string,
    input: CreateDiagnosisInput,
  ): Promise<Diagnosis> {
    const response = await this.request<DataResponse<Diagnosis>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}/diagnoses`,
      { method: "POST", shopId, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async createQuote(
    shopId: string,
    repairOrderId: string,
    input: CreateQuoteInput,
  ): Promise<Quote> {
    const response = await this.request<DataResponse<Quote>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}/quotes`,
      { method: "POST", shopId, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async replaceDraftQuote(
    shopId: string,
    quoteVersionId: string,
    input: CreateQuoteInput,
  ): Promise<Quote> {
    const response = await this.request<DataResponse<Quote>>(
      `/quotes/${encodeURIComponent(quoteVersionId)}`,
      { method: "PATCH", shopId, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async sendQuote(
    shopId: string,
    quoteVersionId: string,
    channel: QuoteSendChannel,
    idempotencyKey: string,
  ): Promise<SendQuoteResult> {
    const response = await this.request<DataResponse<SendQuoteResult>>(
      `/quotes/${encodeURIComponent(quoteVersionId)}/send`,
      { method: "POST", shopId, idempotencyKey, body: JSON.stringify({ channel }) },
    );
    return response.data;
  }

  async createWorkLog(
    shopId: string,
    repairOrderId: string,
    input: CreateWorkLogInput,
    idempotencyKey: string,
  ): Promise<WorkLog> {
    const response = await this.request<DataResponse<WorkLog>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}/work-logs`,
      { method: "POST", shopId, idempotencyKey, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async createPartRequirement(
    shopId: string,
    repairOrderId: string,
    input: CreatePartRequirementInput,
    idempotencyKey: string,
  ): Promise<PartRequirement> {
    const response = await this.request<DataResponse<PartRequirement>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}/part-requirements`,
      { method: "POST", shopId, idempotencyKey, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async updatePartRequirement(
    shopId: string,
    partRequirementId: string,
    input: UpdatePartRequirementInput,
    idempotencyKey: string,
  ): Promise<PartRequirement> {
    const response = await this.request<DataResponse<PartRequirement>>(
      `/part-requirements/${encodeURIComponent(partRequirementId)}`,
      { method: "PATCH", shopId, idempotencyKey, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async createPartUsed(
    shopId: string,
    repairOrderId: string,
    input: CreatePartUsedInput,
    idempotencyKey: string,
  ): Promise<PartUsed> {
    const response = await this.request<DataResponse<PartUsed>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}/parts-used`,
      { method: "POST", shopId, idempotencyKey, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async listQcTemplates(shopId: string, includeInactive = false): Promise<QcTemplate[]> {
    const suffix = includeInactive ? "?includeInactive=true" : "";
    const response = await this.request<DataResponse<QcTemplate[]>>(`/qc-templates${suffix}`, {
      shopId,
    });
    return response.data;
  }

  async createQcTemplate(
    shopId: string,
    input: CreateQcTemplateInput,
    idempotencyKey: string,
  ): Promise<QcTemplate> {
    const response = await this.request<DataResponse<QcTemplate>>("/qc-templates", {
      method: "POST",
      shopId,
      idempotencyKey,
      body: JSON.stringify(input),
    });
    return response.data;
  }

  async deactivateQcTemplate(
    shopId: string,
    qcTemplateId: string,
    idempotencyKey: string,
  ): Promise<QcTemplate> {
    const response = await this.request<DataResponse<QcTemplate>>(
      `/qc-templates/${encodeURIComponent(qcTemplateId)}/deactivate`,
      { method: "POST", shopId, idempotencyKey },
    );
    return response.data;
  }

  async uploadQcEvidence(
    shopId: string,
    repairOrderId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<string> {
    return this.uploadOrderMedia(shopId, repairOrderId, file, "QC", onProgress);
  }

  async uploadHandoverEvidence(
    shopId: string,
    repairOrderId: string,
    file: File,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<string> {
    return this.uploadOrderMedia(shopId, repairOrderId, file, "SIGNATURE", onProgress);
  }

  private async uploadOrderMedia(
    shopId: string,
    repairOrderId: string,
    file: File,
    purpose: "QC" | "SIGNATURE",
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<string> {
    onProgress?.({ stage: "presigning" });
    const presigned = await this.request<
      DataResponse<{ mediaAssetId: string; uploadUrl: string; expiresAt: string }>
    >(`/repair-orders/${encodeURIComponent(repairOrderId)}/media/presign`, {
      method: "POST",
      shopId,
      body: JSON.stringify({
        purpose,
        originalName: file.name,
        mimeType: file.type,
        byteSize: file.size,
      }),
    });

    onProgress?.({ stage: "uploading" });
    let upload: Response;
    try {
      upload = await this.fetcher.call(globalThis, presigned.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
    } catch {
      throw new RepairFlowApiError(
        0,
        "MEDIA_UPLOAD_FAILED",
        "Không thể tải bằng chứng lên. Hãy kiểm tra kết nối và thử lại.",
      );
    }
    if (!upload.ok) {
      throw new RepairFlowApiError(
        upload.status,
        "MEDIA_UPLOAD_FAILED",
        "Không thể tải bằng chứng lên. Hãy thử lại trước khi gửi.",
      );
    }
    onProgress?.({ stage: "complete" });
    return presigned.data.mediaAssetId;
  }

  async submitQcRun(
    shopId: string,
    repairOrderId: string,
    input: CreateQcRunInput,
    idempotencyKey: string,
  ): Promise<QcRunSubmissionResult> {
    const response = await this.request<DataResponse<QcRunSubmissionResult>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}/qc-runs`,
      { method: "POST", shopId, idempotencyKey, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async createPayment(
    shopId: string,
    repairOrderId: string,
    input: CreatePaymentInput,
    idempotencyKey: string,
  ): Promise<PaymentResult> {
    const response = await this.request<DataResponse<PaymentResult>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}/payments`,
      { method: "POST", shopId, idempotencyKey, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async completeHandover(
    shopId: string,
    repairOrderId: string,
    input: CompleteHandoverInput,
    idempotencyKey: string,
  ): Promise<HandoverResult> {
    const response = await this.request<DataResponse<HandoverResult>>(
      `/repair-orders/${encodeURIComponent(repairOrderId)}/handovers`,
      { method: "POST", shopId, idempotencyKey, body: JSON.stringify(input) },
    );
    return response.data;
  }

  async createWarrantyFollowUp(
    shopId: string,
    sourceOrderId: string,
    input: CreateWarrantyFollowUpInput,
    idempotencyKey: string,
  ): Promise<RepairOrderDetail> {
    const response = await this.request<DataResponse<RepairOrderDetail>>(
      `/repair-orders/${encodeURIComponent(sourceOrderId)}/warranty-orders`,
      { method: "POST", shopId, idempotencyKey, body: JSON.stringify(input) },
    );
    return response.data;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { shopId, idempotencyKey, retryAuth = true, headers, ...requestInit } = options;
    if (!this.accessToken) {
      throw new RepairFlowApiError(401, "AUTH_REQUIRED", "Vui lòng đăng nhập để tiếp tục.");
    }
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Accept", "application/json");
    requestHeaders.set("Authorization", `Bearer ${this.accessToken}`);
    if (requestInit.body) requestHeaders.set("Content-Type", "application/json");
    if (shopId) requestHeaders.set("X-Shop-Id", shopId);
    if (idempotencyKey) requestHeaders.set("Idempotency-Key", idempotencyKey);

    const response = await this.fetcher.call(globalThis, `${this.baseUrl}${path}`, {
      ...requestInit,
      headers: requestHeaders,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status === 401 && retryAuth && path !== "/auth/refresh") {
      try {
        await this.restoreSession();
      } catch (error) {
        if (error instanceof RepairFlowApiError && error.code === "SESSION_EXPIRED") {
          this.clearSession();
        }
        throw error;
      }
      return this.request<T>(path, { ...options, retryAuth: false });
    }
    if (!response.ok) throw await apiErrorFromResponse(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
