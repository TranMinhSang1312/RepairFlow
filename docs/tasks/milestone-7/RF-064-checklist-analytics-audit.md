# RF-064 — Checklist suggestion, AI operations UI and final audit

## Mục tiêu

Gợi ý các mục kiểm tra từ checklist/template có sẵn, hoàn thiện màn hình owner quản lý AI flags/budget/analytics và audit toàn bộ Milestone 7. AI chỉ preselect checklist items; không tạo template, không ghi kết quả pass/fail và không hoàn thành QC.

## Phạm vi

- Checklist suggestion API/worker prompt/schema/UI.
- OWNER settings UI dùng RF-060 settings API.
- OWNER analytics API/UI tổng hợp usage, success/failure, latency, cost và review outcomes.
- Browser E2E và final security/operational audit cho cả bốn capabilities.

## Ngoài phạm vi

- AI sinh checklist item mới hoặc sửa/publish QC template.
- AI đánh dấu pass/fail, ký QC, transition trạng thái hoặc bàn giao.
- Analytics chứa prompt/output/input, dữ liệu khách hàng, provider body hoặc chi tiết phiếu.
- Real-provider load test hay tự động dùng production key trong CI.

## Dependencies

- RF-060, RF-061, RF-062 và RF-063 đã merge.
- QC template/run UI/API từ Milestone 5.

## Contract

### Checklist create

`POST /api/v1/ai/checklist-suggestions` — bắt buộc `Idempotency-Key`.

```json
{
  "repairOrderId": "uuid",
  "qcTemplateId": "uuid",
  "phase": "DIAGNOSIS"
}
```

- `phase` là enum allowlist `DIAGNOSIS | QC` và chỉ điều khiển prompt/UI placement.
- Server xác minh repair order/template cùng tenant, template active/compatible device type và actor được đọc phiếu.
- Server tự dựng context tối thiểu từ device type + reported problem đã redaction và allowlist item IDs/labels từ template. Client không gửi arbitrary problem, notes hoặc allowed items.
- Trả `202`; shared run polling/review.

### Output schema

```json
{
  "suggestedItemIds": ["uuid"],
  "reasoningSummary": "string",
  "safetyWarnings": ["string"]
}
```

- IDs phải unique và là subset của items server đã cung cấp.
- `reasoningSummary` ngắn, plain text, không chứa chẩn đoán chắc chắn/giá/deadline.
- `safetyWarnings` chỉ là nhắc nhân viên kiểm tra, không thay thế quy trình an toàn của template.
- Unknown/duplicate/out-of-template IDs làm toàn bộ run `FAILED/AI_OUTPUT_INVALID`.

### Apply

UI hiển thị comparison với template hiện tại. Apply chỉ preselect items trong local diagnosis/QC form. Nhân viên vẫn phải nhập kết quả từng item và dùng API QC hiện có. Không auto-create run, auto-pass, auto-sign hoặc transition.

### Analytics

`GET /api/v1/settings/ai/analytics?from=&to=&capability=&cursor=&limit=` — OWNER only.

Trả aggregate theo ngày/capability:

- requested/succeeded/failed/reviewed counts;
- accepted unchanged/edited/rejected;
- p50/p95 latency;
- input/output tokens và estimated cost micro-USD;
- average edit distance/time-saved khi có sample;
- cursor metadata.

Không trả run ID, repair order ID, user/customer identity, prompt, input snapshot, output, provider body, destination, token hoặc raw exception. Range có giới hạn; empty state hợp lệ. Cross-tenant luôn bị cô lập.

## Settings/operations UI

- Route owner-only `/settings/ai` hoặc route settings tương đương theo shell hiện có.
- Danh sách bốn capability, current global availability, shop flag, budget, usage và optimistic version.
- Enable action cảnh báo rõ output là draft và data policy; không hiển thị/nhập API key trên web.
- Version conflict reloads current settings and preserves proposed values for review.
- Analytics filters phản ánh trên URL, có loading/empty/error/stale behavior và responsive 360px.
- Non-owner không thấy navigation và direct URL bị guard.

## Authorization và tenant rules

- Checklist request/review: OWNER/RECEPTIONIST; TECHNICIAN cần active assignment. Apply UI không trao thêm quyền publish diagnosis/QC.
- Settings/analytics: OWNER active membership only.
- Public portal/token không truy cập.
- Template/order/run khác tenant trả `404`; analytics không thể chọn shop ID từ query.

## File ownership

RF-064 được phép thay đổi:

- Checklist files dưới `apps/api/src/modules/ai/capabilities/checklist-suggestion/**` và `apps/worker/src/ai/capabilities/checklist-suggestion/**`.
- Component dự kiến `apps/web/src/components/repair-orders/ai-checklist-suggestion.tsx` và integration tối thiểu trong diagnosis/QC panels.
- Owner analytics controller/query dưới AI settings module; route dự kiến `apps/web/src/app/(staff)/settings/ai/page.tsx` cùng `apps/web/src/components/settings/ai-settings.tsx` và `ai-analytics.tsx`.
- Shared analytics indexes/query nếu migration additive cần thiết.
- Milestone 7 E2E/fixtures/runbook và OpenAPI/AI/error docs.

Không sửa QC result authority, state transition, notification delivery, payment/handover/warranty hoặc provider contract trừ bug chung có regression test.

## Acceptance criteria

- Suggested IDs luôn là subset của active server-owned template và không tự tạo/check/pass item.
- Apply chỉ đổi local form; QC/diagnosis commands vẫn authoritative.
- Owner có thể bật/tắt từng capability, đặt budget với concurrency và xem aggregate an toàn.
- Non-owner/cross-tenant không đọc settings/analytics.
- Analytics phản ánh requested/success/failure/review/cost mà không rò dữ liệu nội dung.
- Provider lỗi trong bất kỳ capability nào vẫn cho phép hoàn thành end-to-end repair flow thủ công.
- Fake provider chạy deterministic trong CI; optional DeepSeek smoke test chỉ chạy thủ công khi có explicit env/key và không log response body.
- Tất cả exit criteria trong README đạt.

## Test bắt buộc

- Unit: checklist context allowlist, subset/duplicate validator, analytics aggregation/redaction, date range/cursor.
- Integration: checklist role/tenant/assignment/template state, idempotency, invalid IDs/output, provider failure, review; settings owner-only/concurrency; analytics tenant/filter/cursor/empty state.
- Web: checklist loading/success/error/stale/apply, no auto-pass; settings enable/disable/version conflict; analytics URL filters/empty/error/stale; role guard, keyboard và 360px.
- Browser E2E: enable fake capability, create each AI run, poll success, edit/reject, continue and complete a manual workflow; provider failure path; shop A data absent in shop B.
- Security audit: seeded PII/credential/canary absent from outbox, logs, error responses and analytics; no API key/provider body/raw token in DB.
- Operational: worker restart/replay, circuit open/recovery, budget concurrent exhaustion, migration deploy/status, seed, backup/restore compatibility.
- Full format, lint, typecheck, unit/integration/browser E2E, build and Git-status review.

## Definition of Done

- Checklist, settings và analytics contract có OpenAPI/tests/UI hoàn chỉnh.
- Final audit có evidence cho bốn capability, manual fallback, privacy, budget và worker replay.
- Milestone 7 exit criteria được đánh dấu đạt hoặc production-audio dependency được ghi disabled rõ ràng; full checks xanh.

## Final audit report

RF-064 phải tạo hoặc cập nhật runbook/checklist ghi:

- commands đã chạy và kết quả;
- fake-provider evidence cho bốn capability;
- optional DeepSeek smoke result hoặc lý do chưa chạy;
- data egress inventory per capability;
- unresolved production audio dependency;
- feature flags/budgets mặc định sau seed;
- rollback/disable procedure không ảnh hưởng manual workflow.

Không đánh dấu Milestone 7 hoàn tất nếu production audio được tuyên bố supported nhưng chưa có audited transcription adapter. Có thể hoàn tất text/transcript scope và ghi audio production là disabled dependency theo quyết định README.

## AI implementation prompt

```text
Bạn đang làm RF-064 — Checklist suggestion, AI operations UI and final audit trong
C:\RepairFlow.

Đọc AGENTS.md, docs/tasks/milestone-7/README.md,
docs/tasks/milestone-7/RF-064-checklist-analytics-audit.md, toàn bộ RF-060..RF-063,
docs/ai-contracts.md, docs/domain-rules.md, docs/rbac.md, docs/openapi.yaml,
prisma/schema.prisma, docs/screen-specs.md và docs/testing-strategy.md.

Trước khi code, tóm tắt checklist input/output/apply contract, role/tenant/template
rules, settings concurrency, analytics privacy, UI states, file ownership và audit plan.

Triển khai checklist suggestion qua shared AI pipeline; chỉ cho phép suggested IDs từ
server-owned active template và apply vào local form. Triển khai owner AI settings và
privacy-safe aggregate analytics UI/API. Không auto-create template, auto-pass QC,
transition repair order hoặc expose prompt/input/output/provider body trong analytics.

Viết unit/integration/web/browser E2E cho checklist, settings, analytics và cả bốn
capabilities. Audit PII/secret, budget concurrency, worker replay, circuit breaker,
manual fallback, mobile 360px và migration/seed/backup compatibility. Chạy format,
lint, typecheck, toàn bộ test, browser E2E, build, migration deploy/status và seed.
Không commit hoặc push. Báo kết quả final audit và production audio dependency rõ ràng.
```
