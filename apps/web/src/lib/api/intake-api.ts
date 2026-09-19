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

type RequestOptions = RequestInit & {
  shopId?: string;
  idempotencyKey?: string;
  retryAuth?: boolean;
};

export class BrowserIntakeApi implements IntakeApi, RepairOrderReadApi {
  private accessToken: string | null = null;
  private refreshPromise: Promise<AuthData> | null = null;

  constructor(
    private readonly baseUrl = "/api/v1",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  restoreSession(): Promise<AuthData> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<AuthData> {
    const response = await this.fetcher(`${this.baseUrl}/auth/refresh`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw await apiErrorFromResponse(response);
    const body = (await response.json()) as DataResponse<AuthData>;
    this.accessToken = body.data.accessToken;
    return body.data;
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
      upload = await this.fetcher(presigned.data.uploadUrl, {
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

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...requestInit,
      headers: requestHeaders,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status === 401 && retryAuth) {
      await this.restoreSession();
      return this.request<T>(path, { ...options, retryAuth: false });
    }
    if (!response.ok) throw await apiErrorFromResponse(response);
    return (await response.json()) as T;
  }
}
