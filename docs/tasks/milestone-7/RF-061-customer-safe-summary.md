# RF-061 — Customer-safe technical summary

## Mục tiêu

Cho phép nhân viên tạo một bản tóm tắt dễ hiểu cho khách từ các dữ kiện kỹ thuật đã có trong phiếu. Kết quả chỉ là draft để chèn vào trường nội dung đang chỉnh sửa; AI không gửi cho khách, không đổi báo giá và không cam kết thay cửa hàng.

## Phạm vi

- API enqueue customer summary và input builder từ server-owned repair data.
- Prompt/schema versioned cho `CUSTOMER_SUMMARY` qua shared gateway.
- Validator ngăn claim ngoài nguồn, giá, thời hạn, bảo hành và chẩn đoán chắc chắn không được duyệt.
- Staff workspace UI để chọn nguồn, tạo/poll draft, sửa/chèn/từ chối và ghi review telemetry.
- Test API, worker capability và UI states.

## Ngoài phạm vi

- Gửi email/SMS/Zalo hoặc public notification.
- Tự lưu vào quote, timeline, work log hay repair order.
- Tạo chẩn đoán, giá, SLA, warranty terms hoặc legal advice.
- Dùng toàn bộ lịch sử khách hàng hay dữ liệu của phiếu khác làm context.

## Dependencies

- RF-060 đã merge: flags, budgets, shared enqueue/run/review, gateway, worker và fake/DeepSeek adapters.
- Repair order detail, diagnosis/work logs và quote draft API hiện có.

## Contract

### Create

`POST /api/v1/ai/customer-summaries` — bắt buộc `Idempotency-Key`.

```json
{
  "repairOrderId": "uuid",
  "diagnosisId": "uuid",
  "workLogIds": ["uuid"],
  "tone": "CLEAR_NEUTRAL",
  "maxCharacters": 400
}
```

- Cần ít nhất một source ID. Tối đa 20 work log IDs; `maxCharacters` 100–800.
- Không nhận `technicalNotes`, `approvedFacts`, customer text hay system prompt tùy ý từ client.
- Server xác minh source cùng tenant/cùng repair order, actor có quyền đọc và source ở trạng thái hợp lệ; sau đó dựng allowlisted fact list.
- Không đưa customer name, phone, email, address, device credentials, internal part costs, payment data hoặc unrelated history vào snapshot/provider input.
- Trả `202 AiRunResponse`; polling dùng shared run endpoint.

### Output schema

```json
{
  "summary": "string",
  "claimsUsed": ["fact-id"],
  "warnings": ["string"]
}
```

- `summary` không vượt requested max characters sau Unicode normalization.
- Mỗi `claimsUsed` phải thuộc fact IDs server đã cấp cho provider.
- Output không được thêm giá, deadline, guarantee, warranty promise, certainty hoặc diagnosis ngoài fact list.
- Không có Markdown/HTML/script/link; UI render plain text.
- Schema/semantic validator thất bại làm run `FAILED/AI_OUTPUT_INVALID`.

### Review và apply

UI cho phép:

- Copy draft hoặc chèn vào một editable field như quote `customerNote`.
- Sửa draft trước khi chèn.
- Từ chối draft.

Việc save quote/note vẫn gọi API nghiệp vụ hiện có và chịu version/status rules. Sau thao tác, client gọi shared review endpoint với outcome và reviewed output để server tính edit distance. Review endpoint không lưu note hay gửi notification.

## Authorization và tenant rules

- OWNER và RECEPTIONIST được request/review nếu có quyền xem phiếu.
- TECHNICIAN cần active assignment trên repair order và source records phải thuộc phiếu đó.
- Disabled user/membership, public token và customer portal không có quyền.
- Cross-tenant repair/source/run trả `404`; mixed-source request rollback hoàn toàn.

## UI behavior

- Entry point trong repair workspace ở khu vực diagnosis/quote communication.
- Hiển thị nhãn cố định `AI draft`, danh sách nguồn được chọn và cảnh báo phải kiểm tra trước khi dùng.
- Queue/running có progress và nút cancel UI polling, không cancel provider job.
- Failed/timeout/budget/disabled có thông báo ổn định và giữ nguyên nội dung nhân viên đang nhập.
- Polling dùng bounded backoff, dừng khi unmount/terminal và giữ stale draft có nhãn nếu refresh tạm lỗi.
- Mobile 360px không tràn; hành động review vẫn truy cập được bằng bàn phím.

## File ownership

RF-061 được phép thay đổi:

- Capability DTO/input builder dưới `apps/api/src/modules/ai/capabilities/customer-summary/**` hoặc cấu trúc tương đương đã chốt ở RF-060.
- Worker prompt/schema/handler dưới `apps/worker/src/ai/capabilities/customer-summary/**`.
- Repair workspace component dự kiến `apps/web/src/components/repair-orders/ai-customer-summary.tsx`, API client/hook dưới `apps/web/src/lib/ai/**`, và integration tối thiểu trong diagnosis/quote panel.
- Contract/test fixtures của capability.
- `docs/openapi.yaml`, `docs/ai-contracts.md`, `docs/error-codes.md` nếu cần.

Không thay schema nền/budget, không sửa quote totals/send, notification provider hoặc capability khác. Nếu cần shared gateway change, phải giữ backward compatibility và test lại RF-060.

## Acceptance criteria

- Request chỉ dùng server-owned facts từ đúng phiếu; client không thể inject prompt/raw notes.
- DeepSeek chỉ nhận fact list đã redaction và output schema versioned.
- Summary vượt nguồn hoặc chứa prohibited claim không được trả như draft thành công.
- AI draft không tự ghi database nghiệp vụ hoặc gửi khách.
- Nhân viên có thể accept unchanged, edit hoặc reject và telemetry ghi đúng một lần.
- Provider lỗi/feature tắt/budget hết không làm mất note đang soạn hoặc chặn save thủ công.
- Role, assignment, tenant và idempotency đúng contract.

## Test bắt buộc

- Unit: fact builder allowlist/redaction, max length, claims subset, prohibited claim/markup validator và prompt snapshot không chứa PII.
- Integration: success, empty source, source khác phiếu/tenant, role/assignment, disabled flag, idempotent retry/mismatch, provider invalid output và review outcomes.
- Security canary: phone/email/internal cost/device password/raw provider body không có trong outbox/log/error.
- Web: source selection, loading/success/empty/error/stale polling, edit/reject/insert, preserved manual text, keyboard và viewport 360px.
- Regression: normal quote update vẫn authoritative; AI không thay totals/status.
- Format, lint, typecheck, test và build.

## Definition of Done

- API/OpenAPI, schema/prompt version và UI dùng cùng contract.
- Fake-provider integration và web tests chứng minh draft/review/manual fallback.
- Không có provider call hoặc domain write ngoài boundary; full checks xanh và diff chỉ thuộc RF-061.

## AI implementation prompt

```text
Bạn đang làm RF-061 — Customer-safe technical summary trong C:\RepairFlow.

Đọc AGENTS.md, docs/tasks/milestone-7/README.md,
docs/tasks/milestone-7/RF-061-customer-safe-summary.md, docs/ai-contracts.md,
docs/domain-rules.md, docs/rbac.md, docs/openapi.yaml, prisma/schema.prisma,
docs/screen-specs.md và docs/testing-strategy.md.

Trước khi code, tóm tắt create/output/review contract, source facts được phép,
prohibited claims, role/tenant/assignment rules, UI states, file ownership và test plan.

Triển khai POST /api/v1/ai/customer-summaries bằng shared enqueue transaction,
server-owned fact builder, versioned prompt/schema, worker validation và repair workspace
AI-draft UI. Việc insert/save phải dùng command nghiệp vụ hiện có; AI không được gửi
khách, đổi totals/status hoặc tự persist nội dung nghiệp vụ.

Test source/tenant/role/assignment, redaction, idempotency, invalid/unsupported claims,
provider failure, review telemetry, polling failure, manual-text preservation, keyboard
và 360px. Chạy format, lint, typecheck, toàn bộ test phù hợp và build.
Không commit hoặc push. Báo file thay đổi, lệnh kiểm tra, kết quả và vấn đề còn lại.
```
