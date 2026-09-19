import type { Customer, Device, IntakeAccessory, Priority } from "../api/types";

export interface IntakeDraft {
  branchId: string;
  customer: Customer | null;
  device: Device | null;
  reportedProblem: string;
  intakeCondition: string;
  accessories: IntakeAccessory[];
  consentAcknowledged: boolean;
  priority: Priority;
  promisedAt: string;
  uploadedMediaIds: string[];
}

export type IntakeFieldErrors = Partial<Record<keyof IntakeDraft | string, string>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const EMPTY_INTAKE_DRAFT: IntakeDraft = {
  branchId: "",
  customer: null,
  device: null,
  reportedProblem: "",
  intakeCondition: "",
  accessories: [],
  consentAcknowledged: false,
  priority: "NORMAL",
  promisedAt: "",
  uploadedMediaIds: [],
};

export function validateIntakeDraft(draft: IntakeDraft, intakePhotoMinimum = 1): IntakeFieldErrors {
  const errors: IntakeFieldErrors = {};
  if (!UUID_PATTERN.test(draft.branchId.trim())) {
    errors.branchId = "Cần mã chi nhánh hợp lệ để tạo phiếu.";
  }
  if (!draft.customer) errors.customer = "Hãy chọn hoặc tạo khách hàng.";
  if (!draft.device) errors.device = "Hãy chọn hoặc tạo thiết bị.";
  if (!draft.reportedProblem.trim()) errors.reportedProblem = "Mô tả lỗi là bắt buộc.";
  else if (draft.reportedProblem.trim().length > 5000)
    errors.reportedProblem = "Mô tả lỗi không được quá 5.000 ký tự.";
  if (!draft.intakeCondition.trim()) errors.intakeCondition = "Tình trạng tiếp nhận là bắt buộc.";
  else if (draft.intakeCondition.trim().length > 5000)
    errors.intakeCondition = "Tình trạng không được quá 5.000 ký tự.";
  if (!draft.consentAcknowledged)
    errors.consentAcknowledged = "Cần xác nhận đồng ý về dữ liệu và sao lưu.";
  if (draft.uploadedMediaIds.length < intakePhotoMinimum)
    errors.uploadedMediaIds = `Cần ít nhất ${intakePhotoMinimum} ảnh đã tải lên hoàn tất.`;
  if (draft.promisedAt && Number.isNaN(new Date(draft.promisedAt).getTime()))
    errors.promisedAt = "Ngày hẹn không hợp lệ.";
  draft.accessories.forEach((accessory, index) => {
    if (!accessory.name.trim()) errors[`accessories.${index}.name`] = "Tên phụ kiện là bắt buộc.";
    if (accessory.name.trim().length > 100)
      errors[`accessories.${index}.name`] = "Tên phụ kiện không được quá 100 ký tự.";
    if ((accessory.conditionNote?.length ?? 0) > 500)
      errors[`accessories.${index}.conditionNote`] = "Ghi chú không được quá 500 ký tự.";
  });
  return errors;
}

export function toIsoDateTime(localDateTime: string): string | null {
  if (!localDateTime) return null;
  const value = new Date(localDateTime);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export function createIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
