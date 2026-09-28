# RF-060 — AI foundation, feature flags and provider-neutral gateway

## Mục tiêu

Xây nền tảng dùng chung để các API chỉ enqueue AI work, worker gọi provider qua `AiGateway`, output được kiểm tra schema và nhân viên review rõ ràng. DeepSeek là adapter production đầu tiên; fake adapter là mặc định cho test. AI mặc định tắt và không làm gián đoạn luồng nghiệp vụ thủ công.

## Phạm vi

- Persistence cho capability settings, usage period và telemetry của `AiRun`.
- OWNER API quản lý flag/budget và shared run read/review API.
- Transaction tạo `AiRun`, reserve budget và `AI_RUN_REQUESTED_V1` outbox.
- Worker dispatch, lease/idempotency, redaction boundary, schema registry và prompt registry.
- `AiGateway`, fake adapter và DeepSeek adapter.
- Timeout, output limit, retry classification, circuit breaker, cost accounting và safe logging.
- OpenAPI, error catalog, environment examples, seed và tài liệu AI contract.

## Ngoài phạm vi

- Prompt và UI nghiệp vụ của bốn capability.
- Provider call trong request, streaming/chat, RAG, vector database hoặc fine-tuning.
- Tự áp dụng output vào entity nghiệp vụ.
- Dashboard analytics; RF-064 thực hiện.

## Dependencies

- Milestone 6 đã hoàn tất, outbox worker và tenant/RBAC boundary đang hoạt động.
- `AiRun`, `AiCapability` và `AiRunStatus` hiện có trong Prisma.
- Các invariants tại `docs/ai-contracts.md`, `docs/domain-rules.md` và `docs/rbac.md`.

## Contract

### Feature settings

`GET /api/v1/settings/ai` — OWNER, tenant-scoped.

Trả một record cho mỗi `AiCapability`, gồm `enabled`, `monthlyBudgetMicrousd`, `maxRunCostMicrousd`, `lockVersion`, `updatedAt`. Không trả API key, model price table hoặc provider secret.

`PATCH /api/v1/settings/ai/{capability}` — OWNER, tenant-scoped.

```json
{
  "enabled": true,
  "monthlyBudgetMicrousd": "5000000",
  "maxRunCostMicrousd": "250000",
  "expectedLockVersion": 3
}
```

Money dùng decimal string trong HTTP để không mất chính xác. Stale version trả `409 AI_SETTING_VERSION_CONFLICT`. Global `AI_ENABLED=false` luôn thắng shop flag.

### Run read

`GET /api/v1/ai/runs/{aiRunId}` — OWNER/RECEPTIONIST; TECHNICIAN cần active assignment nếu run gắn repair order.

Response mở rộng contract hiện tại với status, capability, prompt/schema version, output an toàn, confidence, stable error code, timestamps và review summary. Không có input snapshot, provider body, provider request ID, prompt, token counts hoặc cost chi tiết.

### Review

`POST /api/v1/ai/runs/{aiRunId}/review`

```json
{
  "outcome": "ACCEPTED_EDITED",
  "reviewedOutput": {},
  "timeSavedSeconds": 75
}
```

- Chỉ nhận run `SUCCEEDED`, cùng tenant và đúng role/assignment.
- `reviewedOutput` bắt buộc cho accepted outcome, phải đạt schema của capability. Server tính normalized edit distance rồi loại bỏ value; không lưu bản reviewed output.
- `REJECTED` không nhận reviewed output và đổi run status sang `REJECTED` để tương thích enum hiện tại.
- Review lần hai trả `409 AI_DRAFT_ALREADY_APPLIED`.
- Endpoint chỉ ghi telemetry; không mutate customer/device/repair order/quote/QC.

### Internal enqueue contract

Mỗi capability gọi shared application service với authenticated actor, shop, capability, optional repair order, idempotency key, input snapshot đã allowlist/redaction, prompt/schema version và upper-bound cost. Trong một database transaction:

1. Lock/create `AiUsagePeriod` của shop, capability và tháng UTC hiện tại.
2. Kiểm tra global flag, shop flag, per-run và monthly budget.
3. Resolve idempotency key theo shop + actor + capability + payload hash.
4. Reserve upper-bound cost.
5. Tạo `AiRun(QUEUED)` và outbox event tối thiểu.
6. Lưu idempotent response rồi commit.

Same key/same payload trả cùng run; mismatch trả `409 IDEMPOTENCY_KEY_REUSED`. Hết budget trả `429 AI_BUDGET_EXCEEDED` và không tạo run/outbox/reservation.

### Worker contract

Worker claim `AI_RUN_REQUESTED_V1`, atomically đổi `QUEUED -> RUNNING`, build provider request từ server-owned source, redaction lần cuối, gọi gateway và reconcile reservation:

- Success: validate JSON schema, persist normalized output/usage/latency/cost, `SUCCEEDED`, complete outbox.
- Provider unavailable/timeout/circuit open: `FAILED` + `AI_PROVIDER_UNAVAILABLE`; release unused reservation.
- Invalid/oversized output: `FAILED` + `AI_OUTPUT_INVALID`; không persist raw output.
- Terminal run khiến delivery lặp trở thành no-op thành công.
- Chỉ retry lỗi được adapter phân loại là an toàn trước inference; không tự retry timeout mơ hồ hoặc invalid output.

Provider failure được thể hiện qua run polling, không biến thành lỗi đồng bộ của request đã trả `202`.

## Persistence và migration

- Thêm `AiCapabilitySetting` với composite key shop/capability, flag, budget, lock version, audit fields.
- Thêm `AiUsagePeriod` với composite key shop/capability/UTC period start, reserved/spent micro-USD và lock version.
- Thêm `AiReviewOutcome` enum.
- Mở rộng `AiRun` bằng `startedAt`, input/output tokens, reserved/estimated cost, latency, review outcome/reviewer/review time/edit-distance/time-saved. Giữ `acceptedByUserId` và `acceptedAt` hiện tại cho accepted outcomes.
- `inputReference` được định nghĩa lại rõ: private, server-only, minimal redacted snapshot/IDs; không xuất qua API hoặc log.
- Migration phải additive, có index cho worker/status và analytics, deploy được trên dữ liệu cũ.
- Seed tạo setting disabled cho mọi capability của demo shop và không chứa DeepSeek key.

## Security và dữ liệu

- Redactor chặn contact fields, address, passwords/PIN/device credentials, auth/public tokens và các chuỗi secret phổ biến trước gateway.
- Capability input builder dùng allowlist, không nhận object/prompt tùy ý từ client.
- DeepSeek API key chỉ đọc từ runtime env, không vào database, test fixture, snapshot, log hoặc error.
- Base URL production phải HTTPS và nên mặc định cố định `https://api.deepseek.com`; custom URL chỉ qua explicit config validation.
- Logger chỉ dùng run/shop/capability/status/latency/error classification; không dùng output, prompt, input snapshot hoặc provider response body.
- Circuit breaker tách theo provider/model trong worker process; mở breaker không tắt manual workflow.

## Provider interface

Application phụ thuộc interface chuẩn hóa:

```ts
interface AiGateway {
  generate(request: AiGatewayRequest): Promise<AiGatewayResult>;
}
```

Request gồm capability, prompt/schema version, sanitized input, timeout và max output bytes. Result gồm parsed JSON, normalized token usage, latency và provider/model alias. Provider-specific status/headers/types chỉ tồn tại trong adapter.

DeepSeek adapter dùng structured JSON output, abort signal và size-bounded body parsing. Model được cấu hình. Fake adapter cho phép fixture success, timeout, invalid JSON, schema mismatch, 429/5xx và delayed response.

## Error codes

RF phải thêm hoặc xác nhận trong catalog:

- `AI_FEATURE_DISABLED` — 409 khi global/shop capability chưa bật.
- `AI_SETTING_VERSION_CONFLICT` — 409.
- `AI_RUN_NOT_REVIEWABLE` — 409 khi run chưa có successful draft.
- `AI_BUDGET_EXCEEDED` — 429.
- `AI_PROVIDER_UNAVAILABLE` — terminal run error, không lộ provider body.
- `AI_PROVIDER_OUTCOME_UNKNOWN` — terminal run error sau khi recover một execution mơ hồ; không tự gọi provider lần hai.
- `AI_AUTHORIZATION_REVOKED` — terminal run error nếu membership/assignment không còn hợp lệ trước provider call.
- `AI_OUTPUT_INVALID` — terminal run error.
- `AI_DRAFT_ALREADY_APPLIED` — 409.

Cross-tenant/not-found vẫn dùng quy ước `404`; validation dùng error envelope hiện có.

## File ownership

RF-060 được phép thay đổi:

- `prisma/schema.prisma`, `prisma/migrations/<rf-060-ai-foundation>/migration.sql` và `prisma/seed.ts` cho AI settings.
- Các file mới dự kiến dưới `apps/api/src/modules/ai/`: module, settings/run controllers, DTO/types, repositories, enqueue/budget/redaction/schema-registry services.
- Các file mới dự kiến dưới `apps/worker/src/ai/`: outbox handler, gateway types, fake adapter, DeepSeek adapter, prompt/schema registry và tests.
- `apps/api/src/app.module.ts` và worker outbox processor/bootstrap chỉ để đăng ký module/dispatch event mới; notification handler phải giữ độc lập.
- Shared environment/config/schema utilities thực sự cần thiết.
- `docs/openapi.yaml`, `docs/error-codes.md`, `docs/ai-contracts.md`, `.env.example` và tài liệu vận hành liên quan.
- Unit/integration tests của foundation.

Không sửa UI capability, customer/device/quote/work/QC domain hoặc notification payload contract.

## Acceptance criteria

- AI và mọi shop capability mặc định tắt; manual workflow vẫn hoạt động đầy đủ.
- OWNER quản lý setting với optimistic concurrency; role khác bị từ chối và tenant khác không được suy ra sự tồn tại.
- Enqueue là transaction nguyên tử giữa budget reservation, run, outbox và idempotency.
- HTTP request không gọi DeepSeek; worker là nơi duy nhất gọi gateway.
- DeepSeek và fake adapter cùng tuân thủ interface; application không import provider-specific type.
- Output sai không được lưu/applied; raw provider response không xuất hiện trong database/log/error/outbox.
- Timeout/circuit/budget hoạt động xác định và không khóa luồng thủ công.
- Review một lần, đúng role/tenant/assignment, không mutate domain.
- Migration deploy/status và rollback-safe review đạt.

## Test bắt buộc

- Unit: redaction allow/deny, schema registry, output-size guard, cost calculation, circuit breaker, DeepSeek response normalization và fake fixtures.
- Integration: settings role/tenant/concurrency; enqueue success/rollback/idempotent retry/mismatch; concurrent budget reservation; worker success/failure/terminal replay; review success/edited/rejected/reuse.
- Security: cross-tenant run/settings, disabled user/membership, technician without assignment, secret/PII canary absent from DB log outbox và error.
- Provider: timeout, 429/5xx classification, invalid JSON/schema, missing key fail-fast, no network in unit/CI.
- Regression: notification outbox delivery vẫn đạt và non-AI APIs không cần AI config.
- Chạy format, lint, typecheck, toàn bộ test, build, migration deploy/status và seed.

## Definition of Done

- Source-of-truth docs, OpenAPI, Prisma và runtime thống nhất; không còn TODO contract cho RF-061..RF-064.
- Clean database và upgraded database deploy được migration; seed idempotent và flags vẫn disabled.
- Fake provider chứng minh toàn bộ state/error paths mà không cần network/secret.
- Diff chỉ chứa foundation files đã liệt kê; format/lint/typecheck/test/build/migration checks đều xanh.

## AI implementation prompt

```text
Bạn đang làm RF-060 — AI foundation, feature flags and provider-neutral gateway trong C:\RepairFlow.

Đọc theo thứ tự: AGENTS.md, docs/tasks/milestone-7/README.md,
docs/tasks/milestone-7/RF-060-ai-foundation-gateway.md, docs/ai-contracts.md,
docs/domain-rules.md, docs/architecture.md, docs/rbac.md, docs/openapi.yaml,
docs/error-codes.md, prisma/schema.prisma và docs/testing-strategy.md.

Trước khi code, tóm tắt feature-flag precedence, API contract, persistence,
budget/idempotency transaction, outbox lifecycle, provider boundary, dữ liệu được
phép rời hệ thống, file ownership và kế hoạch test.

Sau đó triển khai persistence/migration/seed, OWNER settings API, run read/review,
shared enqueue service, AI outbox worker, schema/prompt registry, redaction,
budget accounting, fake provider và DeepSeek adapter qua AiGateway độc lập provider.
Không gọi provider trong HTTP request và không để DeepSeek type/SDK thoát khỏi adapter.
Không triển khai prompt hoặc UI nghiệp vụ của RF-061 đến RF-064.

Test role/tenant/assignment, disabled flags, optimistic concurrency, transaction
rollback, idempotency, concurrent budget, timeout, circuit breaker, invalid output,
terminal replay và PII/secret absence. Cập nhật OpenAPI/error/AI contract nếu public
contract thay đổi. Chạy format, lint, typecheck, toàn bộ test, build, migration
deploy/status và seed. Không commit hoặc push.

Cuối cùng báo file thay đổi, migration, lệnh kiểm tra, kết quả và rủi ro còn lại.
```
