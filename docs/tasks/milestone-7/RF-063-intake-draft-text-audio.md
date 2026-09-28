# RF-063 — Intake draft from text or audio transcript

## Mục tiêu

Biến mô tả tự do hoặc transcript từ ghi âm thành các trường intake có cấu trúc: vấn đề khách báo, tình trạng nhìn thấy, phụ kiện, lời khai của khách và điểm chưa chắc chắn. Kết quả chỉ điền form nháp và không tự tạo customer/device/repair order.

## Quyết định về audio

DeepSeek là provider đầu tiên cho bước tạo draft từ text/transcript. Không giả định DeepSeek có speech-to-text production nếu contract chính thức được dùng tại thời điểm triển khai không hỗ trợ audio.

Audio dùng boundary riêng `TranscriptionGateway`. RF này phải có fake adapter và toàn bộ pipeline/test, nhưng sub-feature audio mặc định tắt trong production. Chỉ được bật khi đã chọn provider speech-to-text, kiểm duyệt data residency/retention, thêm adapter và cấu hình hợp lệ. Text và transcript do nhân viên nhập vẫn dùng đầy đủ với DeepSeek.

## Phạm vi

- Endpoint enqueue intake draft với source union text/transcript/audio media.
- Redaction/normalization trước khi lưu snapshot hoặc gọi provider.
- Optional transcription stage qua provider-neutral gateway.
- Versioned prompt/schema cho `INTAKE_DRAFT` qua `AiGateway`.
- Web intake capture/paste flow, draft comparison và review telemetry.
- Media purpose/migration tối thiểu cho private intake audio nếu audio pipeline được bật.

## Ngoài phạm vi

- Chọn hoặc tích hợp speech-to-text production trong RF này.
- Ghi âm cuộc gọi bí mật, speaker identification, sentiment scoring hoặc voice biometrics.
- Lưu transcript vào customer profile/timeline hay gửi cho khách.
- Tự tạo entity hoặc suy luận diagnosis/quote/repair commitment.

## Dependencies

- RF-060.
- Intake/media infrastructure RF-014/RF-017.
- Production audio acceptance phụ thuộc một RF/provider decision riêng; text path không phụ thuộc.

## Contract

### Create

`POST /api/v1/ai/intake-drafts` — bắt buộc `Idempotency-Key`.

Text/transcript:

```json
{
  "source": { "type": "TEXT", "text": "..." },
  "deviceType": "PHONE",
  "language": "vi"
}
```

```json
{
  "source": { "type": "TRANSCRIPT", "text": "...", "sourceMediaAssetId": "uuid" },
  "deviceType": "LAPTOP",
  "language": "vi"
}
```

Audio:

```json
{
  "source": { "type": "AUDIO", "mediaAssetId": "uuid" },
  "deviceType": "PHONE",
  "language": "vi"
}
```

- `TEXT`/`TRANSCRIPT` giới hạn ký tự/byte, Unicode normalize và redaction trước khi lưu private input snapshot.
- `AUDIO` chỉ nhận private completed media cùng tenant, purpose `AI_INTAKE_AUDIO`, allowed MIME/duration/size và audio sub-flag bật.
- `sourceMediaAssetId` của TRANSCRIPT chỉ là provenance optional; server không đọc audio ở path này.
- Không nhận customer identity, arbitrary system prompt, prior history hoặc domain entity object.
- Trả `202`; request không gọi transcription hay DeepSeek.

### Worker stages

1. Re-check membership/assignment, feature flags và referenced media.
2. Với AUDIO, tải private bytes và gọi `TranscriptionGateway`; raw bytes không vào AI outbox/DB/log.
3. Normalize/redact transcript. Nếu redaction phát hiện credential/token hoặc input không còn nội dung hữu ích, fail an toàn.
4. Gọi `AiGateway`/DeepSeek với sanitized transcript, device type, language và JSON schema.
5. Validate output và persist only final structured draft plus normal run telemetry. Raw audio/transcription-provider body không được persist; transcript trung gian không trả qua run API.

Transcription failure dùng stable `AI_TRANSCRIPTION_UNAVAILABLE`; AI draft provider/output lỗi dùng error codes chung. Không retry timeout mơ hồ gây gửi audio lặp không kiểm soát.

### Output schema

```json
{
  "reportedProblem": "string",
  "visibleCondition": "string",
  "accessories": ["string"],
  "customerClaims": ["string"],
  "uncertainties": ["string"]
}
```

- Plain text, bounded lengths/list counts; không HTML/Markdown/link.
- Không được đổi lời kể thành diagnosis, cam kết sửa được, giá, deadline hoặc warranty.
- `visibleCondition` chỉ chứa điều người nói mô tả đã nhìn thấy; không tự nhận là kết quả kiểm tra của cửa hàng.
- Uncertain/missing information phải ở `uncertainties`, không được AI tự điền.

## Authorization, consent và tenant rules

- OWNER/RECEPTIONIST dùng trong new intake.
- TECHNICIAN chỉ dùng trên repair order được assignment nếu luồng tương lai gắn phiếu; không có quyền với unbound intake audio.
- Cross-tenant media/run trả `404`.
- UI phải hiển thị thông báo xin sự đồng ý trước khi bắt đầu ghi âm và trạng thái upload; consent là thao tác rõ ràng, không pre-checked.
- Audio object tuân retention ngắn của intake media và phải có cleanup; feature tắt không cho tạo AI audio media mới.

## UI behavior

- Người dùng chọn nhập text/paste transcript hoặc ghi âm khi audio sub-flag khả dụng.
- Form thủ công luôn dùng được. AI panel không reset customer/device/problem data.
- Draft comparison theo từng trường; nhân viên chọn/sửa từng giá trị trước khi apply vào local intake form.
- Apply không submit intake. Submit vẫn gọi customer/device/repair-order APIs hiện có.
- Queue/running/upload/transcribing/generating có labels rõ; polling failure giữ local form và draft cũ có stale label.
- Audio controls có keyboard labels, duration/size display và mobile 360px.

## File ownership

RF-063 được phép thay đổi:

- Intake DTO/input builder dưới `apps/api/src/modules/ai/capabilities/intake-draft/**` và prompt/schema/handler tương ứng dưới `apps/worker/src/ai/capabilities/intake-draft/**`.
- `apps/worker/src/transcription/**` cho `TranscriptionGateway` interface + fake adapter; production adapter không thuộc RF nếu chưa được chọn.
- Minimal media-purpose Prisma migration và media validation cho AI audio, nếu audio pipeline được scaffold.
- Component dự kiến `apps/web/src/components/intake/ai-intake-draft.tsx`, AI client/hook dưới `apps/web/src/lib/ai/**`, integration trong `new-intake-flow.tsx` và tests.
- OpenAPI/error/AI contract/environment docs liên quan.

Không sửa create repair-order transaction, customer/device writes, diagnosis/quote or other AI capabilities.

## Acceptance criteria

- Text/transcript path hoàn chỉnh qua DeepSeek gateway và fake CI provider.
- Audio path chỉ bật khi global/shop capability, audio sub-flag và transcription provider đều hợp lệ; thiếu provider fail-fast/disabled, không rơi về browser/vendor ngầm.
- Request không gọi provider; worker không persist/log raw audio, raw transcript response hoặc provider body.
- Output luôn là draft và không tự tạo/update entity.
- PII/credential redaction chạy trước persistence/provider; prohibited input fail an toàn.
- Consent, tenant, role, media ownership/expiry và retention được kiểm tra.
- Provider/transcription failure không cản intake thủ công hoặc làm mất dữ liệu form.

## Test bắt buộc

- Unit: source discriminated union, byte/character limits, Unicode/redaction, output schema/semantic rules, transcription gateway normalization.
- Integration text: success, idempotency/mismatch, flag/budget, role/tenant, provider failure/invalid output và review.
- Integration audio với fake: consent/flag/config, completed/expired/cross-tenant media, MIME/size/duration, transcription failure, DeepSeek failure after transcription và cleanup.
- Security canaries: identity/contact/credential/raw audio/transcript/provider body/API key absent from outbox/log/error/final run data ngoài minimal sanitized input snapshot đã định nghĩa.
- Web: text/paste, audio unavailable/available, consent, upload/progress, field comparison/edit/reject, stale polling, preserved manual form, keyboard và 360px.
- Regression: intake submit transaction vẫn authoritative.
- Format, lint, typecheck, test, build và migration checks nếu có schema change.

## Definition of Done

- Text/transcript path production-ready qua DeepSeek adapter và audio boundary testable bằng fake.
- Production audio vẫn disabled trừ khi audited adapter/config tồn tại; UI phản ánh đúng khả dụng.
- Privacy/media/manual fallback tests và full checks xanh; diff chỉ thuộc RF-063.

## AI implementation prompt

```text
Bạn đang làm RF-063 — Intake draft from text or audio transcript trong C:\RepairFlow.

Đọc AGENTS.md, docs/tasks/milestone-7/README.md,
docs/tasks/milestone-7/RF-063-intake-draft-text-audio.md, docs/ai-contracts.md,
docs/domain-rules.md, docs/architecture.md, docs/rbac.md, docs/openapi.yaml,
prisma/schema.prisma, docs/screen-specs.md và docs/testing-strategy.md.

Trước khi code, tóm tắt source union, text/audio provider boundaries, feature-flag
precedence, consent/media rules, redaction/persistence, output schema, UI apply behavior,
file ownership và test plan. Không giả định DeepSeek hỗ trợ speech-to-text.

Triển khai text/transcript intake draft qua shared AI enqueue/worker và DeepSeek adapter.
Thiết kế/triển khai TranscriptionGateway cùng fake adapter và audio pipeline bị tắt mặc
định khi chưa có production speech provider. Kết quả chỉ điền local form draft; không
tự tạo customer/device/repair order và không gọi provider trong HTTP request.

Test role/tenant, flags/budget, idempotency, input redaction, invalid output, provider
failure, audio media/consent/config, fake transcription, privacy canaries, form
preservation, accessibility và 360px. Chạy format, lint, typecheck, test, build và
migration checks. Không commit hoặc push. Báo rõ production audio còn phụ thuộc gì.
```
