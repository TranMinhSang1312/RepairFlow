# RF-053 — Owner notification operations

## Mục tiêu

Cho phép owner quan sát notification job lỗi và yêu cầu retry an toàn mà không truy cập payload, recipient, token, provider body hoặc worker internals.

## Contract

- `GET /api/v1/operations/notifications`: danh sách tenant-bound `FAILED`/`DEAD_LETTER`, filter theo status, event type, channel và cursor `(createdAt,id)`.
- `GET /api/v1/operations/notifications/{outboxEventId}`: safe operational metadata của một job lỗi.
- `POST /api/v1/operations/notifications/{outboxEventId}/retry`: body `{expectedLockVersion}`, bắt buộc `Idempotency-Key`; đưa job về `PENDING` và để worker xử lý sau request.

Response chỉ gồm event/aggregate identifier, status, attempt counters, safe error codes, timestamps, lock version và delivery metadata an toàn. Không trả `OutboxEvent.payload`, `destinationHash`, `providerMessageId`, `lockedBy`, raw token, public URL hoặc credential.

## Quyền và tenant

- Chỉ active `OWNER` có capability `NOTIFICATION_OPERATIONS_MANAGE`.
- Mọi query/update bắt buộc `shopId` từ tenant context.
- ID tenant khác trả `RESOURCE_NOT_FOUND`.

## Retry transaction

1. Đọc job theo shop và ID trong transaction.
2. Chỉ chấp nhận `FAILED` hoặc `DEAD_LETTER`.
3. So sánh `expectedLockVersion`; worker tăng `lockVersion` ở mọi claim/complete/fail.
4. Atomic update job về `PENDING`, xóa lease/error/completion, reset event attempt budget và tăng version.
5. Đưa delivery `FAILED` về `PENDING`; delivery `SENT` giữ nguyên để không gửi lại.
6. Ghi audit chỉ với safe status/error/attempt metadata.
7. Commit. Request không resolve message và không gọi provider.

## UI

- Route owner-only `/settings/notifications`.
- Filter status/event/channel, loading/empty/error states và cursor “Tải thêm”.
- Card hiển thị event, aggregate, attempt, safe error, timestamps và deliveries.
- Retry có confirmation, idempotency key ổn định cho cùng command và xử lý conflict bằng reload.
- Layout usable ở viewport 360 px.

## Schema

- Thêm `OutboxEvent.lockVersion Int @default(0)` với check non-negative.
- Thêm tenant/status/createdAt/id index phục vụ operations list.

## Acceptance criteria

- Owner list/detail/retry được; receptionist, technician và inactive membership bị chặn.
- Tenant khác không thể suy ra job tồn tại.
- Cursor/filter ổn định, validation rõ ràng.
- Response/audit không chứa payload, destination hash, provider message, token hoặc secret.
- Hai retry đồng thời chỉ một request thắng.
- Worker claim cạnh tranh với owner retry làm stale update thất bại.
- Retry không gọi provider; worker xử lý sau commit với stable provider idempotency key cũ.
- `SENT` delivery không bị reset; `FAILED` delivery trở lại `PENDING`.
- OpenAPI, Prisma migration, API/UI test và tài liệu khớp hành vi.

## AI implementation prompt

Triển khai owner notification operations theo contract trong file này. Giữ API tenant-bound, safe mapping allowlist, optimistic `lockVersion`, idempotent audited retry và provider ngoài request. Viết test role, tenant, filter, cursor, response redaction, retry, concurrency, audit, loading/empty/error và viewport 360 px. Chạy format, lint, typecheck, full test, build và migration checks. Không commit hoặc push.
