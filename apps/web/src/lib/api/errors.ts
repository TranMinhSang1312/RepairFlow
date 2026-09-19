import type { ApiErrorDetail, ApiErrorEnvelope } from "./types";

const SAFE_MESSAGES: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: "Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.",
  SESSION_EXPIRED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  PERMISSION_DENIED: "Bạn không có quyền thực hiện thao tác này.",
  RESOURCE_NOT_FOUND: "Không tìm thấy dữ liệu trong cửa hàng đang chọn.",
  SHOP_NOT_FOUND: "Không tìm thấy cửa hàng đang chọn.",
  MEMBERSHIP_INACTIVE: "Quyền truy cập cửa hàng này không còn hoạt động.",
  IDEMPOTENCY_KEY_REUSED: "Yêu cầu này đã được dùng với dữ liệu khác. Hãy tải lại trang.",
  INTAKE_PHOTOS_REQUIRED: "Cửa hàng yêu cầu thêm ảnh tiếp nhận.",
  MEDIA_UPLOAD_INCOMPLETE: "Có ảnh chưa tải lên hoàn tất. Hãy thử tải lại ảnh.",
  MEDIA_TYPE_NOT_ALLOWED: "Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.",
  MEDIA_TOO_LARGE: "Mỗi ảnh phải nhỏ hơn hoặc bằng 15 MB.",
  STORAGE_UNAVAILABLE: "Kho ảnh đang tạm thời gián đoạn. Hãy thử lại.",
  VALIDATION_FAILED: "Một số thông tin chưa hợp lệ. Hãy kiểm tra các trường được đánh dấu.",
  RATE_LIMITED: "Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.",
  EMAIL_ALREADY_REGISTERED: "Email này đã được đăng ký.",
  NETWORK_RESPONSE_INVALID: "Máy chủ trả về phản hồi không hợp lệ. Hãy thử lại.",
};

export class RepairFlowApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "RepairFlowApiError";
  }

  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(
      this.details
        .filter((detail): detail is ApiErrorDetail & { field: string } => Boolean(detail.field))
        .map((detail) => [
          detail.field,
          detail.message ?? SAFE_MESSAGES[detail.code] ?? "Giá trị chưa hợp lệ.",
        ]),
    );
  }
}

function isEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string",
  );
}

export async function apiErrorFromResponse(response: Response): Promise<RepairFlowApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (isEnvelope(body)) {
    return new RepairFlowApiError(
      response.status,
      body.error.code,
      SAFE_MESSAGES[body.error.code] ?? body.error.message ?? "Yêu cầu không thành công.",
      body.error.details ?? [],
      body.error.requestId,
    );
  }

  return new RepairFlowApiError(
    response.status,
    "NETWORK_RESPONSE_INVALID",
    "Máy chủ trả về phản hồi không hợp lệ. Hãy thử lại.",
  );
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof RepairFlowApiError) return error.message;
  return "Không thể kết nối với máy chủ. Dữ liệu bạn đã nhập vẫn được giữ lại.";
}
