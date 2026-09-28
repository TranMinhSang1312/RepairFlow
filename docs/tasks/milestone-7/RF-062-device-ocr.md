# RF-062 — Device OCR draft

## Mục tiêu

Dùng ảnh intake đã upload để gợi ý brand, model, serial và IMEI cho form thiết bị. OCR chỉ điền draft; nhân viên chọn từng trường, sửa và xác nhận trước khi tạo/cập nhật thiết bị.

## Phạm vi

- Hoàn thiện contract `POST /api/v1/ai/device-ocr` hiện có.
- Server xác minh media, worker đọc private object và DeepSeek adapter nhận image data URL có giới hạn.
- Versioned prompt/schema và deterministic field validators.
- Tích hợp vào bước thiết bị của web new-intake.
- Review telemetry cho accept unchanged/edited/rejected.

## Ngoài phạm vi

- Nhận diện người/khuôn mặt, biển số, giấy tờ tùy thân hoặc trích dữ liệu khách hàng.
- Tự tạo/cập nhật device, tự mở repair order hoặc tự đính media vào entity khác.
- OCR hàng loạt, video, PDF hoặc ảnh từ URL do client cung cấp.
- Lưu raw image/provider response vào database/log.

## Dependencies

- RF-060.
- Media presign/complete flow RF-014 và intake UI RF-017.
- Object storage private access đang hoạt động.

## Contract

### Create

`POST /api/v1/ai/device-ocr` — bắt buộc `Idempotency-Key`.

```json
{
  "mediaAssetId": "uuid",
  "allowedFields": ["brand", "model", "serialNumber", "imei"]
}
```

- `allowedFields` optional; mặc định là bốn trường trên, không nhận field khác.
- Media phải cùng tenant, upload `COMPLETED`, chưa hết hạn, purpose intake/AI device image, MIME trong JPEG/PNG/WebP và dưới giới hạn cấu hình.
- Media gắn repair order thì actor phải có quyền trên phiếu; media intake chưa gắn phiếu vẫn cần active tenant membership.
- API chỉ lưu media ID/metadata cần thiết trong `inputReference`, không lưu bytes hay signed URL.
- Trả `202`; worker mới tải object bằng server credential.

### Provider input

Worker re-check ownership/status/expiry/MIME/size ngay trước khi tải. Bytes được truyền cho gateway dưới dạng bounded data URL trong memory và phải được loại bỏ sau call. Signed URL, bucket/key, EXIF location và object credential không đi vào prompt/log. Nếu adapter/model không hỗ trợ image input, run fail bằng stable provider-unavailable classification.

### Output schema

```json
{
  "brand": { "value": "string|null", "confidence": 0.0 },
  "model": { "value": "string|null", "confidence": 0.0 },
  "serialNumber": { "value": "string|null", "confidence": 0.0 },
  "imei": { "value": "string|null", "confidence": 0.0 },
  "warnings": ["string"]
}
```

- Chỉ trả keys được yêu cầu; null khi không đọc chắc chắn.
- Normalize whitespace/Unicode; enforce per-field length và printable characters.
- IMEI giữ kiểu string, chỉ 15 decimal digits và phải qua Luhn khi non-null; không sửa/đoán digit.
- Serial/model không được chứa prompt/HTML hoặc nội dung ngoài ảnh.
- Confidence 0..1 là gợi ý hiển thị, không được dùng để auto-accept.

## Authorization và tenant rules

- OWNER/RECEPTIONIST có thể request/review trong active tenant.
- TECHNICIAN cần active assignment nếu media đã gắn repair order; intake media chưa gắn phiếu không được technician sử dụng trừ khi RBAC sau này quy định rõ.
- Cross-tenant/not-found trả `404`; expired/incomplete media trả stable validation/state error.
- Worker reauthorization thất bại sau enqueue phải fail run và không tải object/provider-call.

## UI behavior

- Nút `Quét thông tin bằng AI` chỉ xuất hiện khi flag `DEVICE_OCR` bật và có ảnh hợp lệ.
- Queue/running hiển thị trạng thái; form vẫn nhập tay được.
- Kết quả mở comparison panel có ảnh thumbnail nội bộ, current value, AI value, confidence và checkbox cho từng field.
- Không field nào được chọn mặc định chỉ vì confidence cao. Apply chỉ đổi local form state.
- Nhân viên có thể sửa sau apply; submit device/intake vẫn qua validation/API hiện có.
- Error giữ nguyên mọi field người dùng đã nhập; mobile 360px xếp comparison theo cột.

## File ownership

RF-062 được phép thay đổi:

- Device OCR DTO/input builder dưới `apps/api/src/modules/ai/capabilities/device-ocr/**` và prompt/schema/handler tương ứng dưới `apps/worker/src/ai/capabilities/device-ocr/**`.
- DeepSeek adapter image-input path nhưng không thay interface chung ngoài backward-compatible extension.
- Component dự kiến `apps/web/src/components/intake/ai-device-ocr.tsx`, AI client/hook dưới `apps/web/src/lib/ai/**`, integration tối thiểu trong `apps/web/src/components/intake/new-intake-flow.tsx` và tests.
- OpenAPI/AI contract/error catalog liên quan OCR.

Không sửa media upload lifecycle, device domain write rules, repair-order transaction hoặc capability khác.

## Acceptance criteria

- Existing OpenAPI path được giữ hoặc thay đổi có migration contract rõ; không sửa âm thầm.
- Chỉ worker gọi provider và chỉ sau khi re-check media ownership/state.
- Ảnh, signed URL, EXIF, object key và provider body không có trong DB log/outbox/error.
- Invalid MIME/size/expired/incomplete/cross-tenant media không tạo provider call.
- Output sai IMEI/schema làm run failed, không partial success.
- Apply chỉ đổi local draft; submit vẫn cần human action và domain validation.
- Provider/flag/budget failure không cản nhập tay.

## Test bắt buộc

- Unit: media eligibility, allowedFields, MIME/size, IMEI/Luhn, output normalization/schema và image adapter body bounds.
- Integration: success, idempotency, tenant/role/assignment, incomplete/expired/deleted media, object-not-found, provider failure/invalid output và review reuse.
- Security: canary bytes/signed URL/object key/API key absent from DB/log/outbox/errors; adapter clears/does not retain fixture buffer.
- Web: no-image/flag-off, loading, success, partial/null fields, select/edit/apply/reject, error preserves form, keyboard và 360px.
- Build and test with fake image-capable provider; no real DeepSeek network in CI.
- Format, lint, typecheck, test và build.

## Definition of Done

- OCR OpenAPI, media rules, worker schema và UI mapping thống nhất.
- Fake image provider và security canaries đạt; manual device entry không phụ thuộc AI.
- Full checks xanh và diff chỉ thuộc RF-062 hoặc shared adapter extension có regression test.

## AI implementation prompt

```text
Bạn đang làm RF-062 — Device OCR draft trong C:\RepairFlow.

Đọc AGENTS.md, docs/tasks/milestone-7/README.md,
docs/tasks/milestone-7/RF-062-device-ocr.md, docs/ai-contracts.md,
docs/domain-rules.md, docs/rbac.md, docs/openapi.yaml, prisma/schema.prisma,
docs/screen-specs.md và docs/testing-strategy.md.

Trước khi code, tóm tắt create/output contract, media eligibility và recheck,
image data boundary, tenant/role rules, IMEI validation, UI apply semantics,
file ownership và test plan.

Triển khai POST /api/v1/ai/device-ocr qua shared enqueue/worker, server-owned media
loading, DeepSeek image adapter, versioned schema/validator và intake comparison UI.
Ảnh/output chỉ tạo local draft; không tự ghi device hoặc repair order. Không log/store
bytes, signed URL, object key, provider body hoặc secret.

Test role/tenant/assignment, idempotency, incomplete/expired/cross-tenant media,
MIME/size, object failure, invalid IMEI/schema, provider failure, PII/secret absence,
review outcomes, form preservation, keyboard và viewport 360px. Chạy format, lint,
typecheck, test và build. Không commit hoặc push. Báo file thay đổi và kết quả.
```
