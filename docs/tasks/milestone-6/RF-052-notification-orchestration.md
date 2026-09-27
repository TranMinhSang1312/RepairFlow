# RF-052 — Notification orchestration for business events

## Mục tiêu

Hoàn thiện orchestration EMAIL cho bốn hành động nghiệp vụ đã có: gửi báo giá, chuyển phiếu sang sẵn sàng trả máy, hoàn tất bàn giao và mời nhân viên. Request chỉ ghi domain state, outbox và delivery trong cùng transaction; worker mới resolve recipient, dựng nội dung và gọi provider.

## Kết quả nghiệp vụ

- Email báo giá tiếp tục hoạt động theo `QUOTE_SENT_V1` của RF-051.
- Khách hàng có email trong intake snapshot nhận thông báo khi thiết bị sẵn sàng và khi bàn giao hoàn tất.
- Owner tạo hoặc phát hành lại lời mời nhân viên sẽ tạo đúng một delivery EMAIL có thể retry.
- Mọi notification gắn với business action được commit hoặc rollback cùng action đó.
- Recipient, raw public token, public URL và provider payload không nằm trong outbox hoặc log.

## Phạm vi

1. Thêm versioned event/template contract cho:
   - `REPAIR_ORDER_READY` / `REPAIR_ORDER_READY_V1`;
   - `REPAIR_ORDER_COMPLETED` / `HANDOVER_COMPLETED_V1`;
   - `STAFF_INVITATION_CREATED` / `STAFF_INVITATION_V1`.
2. Tạo `OutboxEvent` và `NotificationDelivery(EMAIL)` trong transaction đã sở hữu business action.
3. Phiếu sửa chữa chỉ tạo delivery khi immutable `customerSnapshot.email` hợp lệ; staff invitation luôn có email hợp lệ từ invitation record.
4. Worker chỉ claim EMAIL cho bốn event được allowlist.
5. Worker resolve mọi context theo `event.shopId`, aggregate ID và persisted binding.
6. Track/invitation token được tái tạo trong RAM từ metadata, rồi so sánh constant-time với token hash persisted trước khi render link.
7. Dùng provider idempotency key ổn định từ event và delivery ID theo RF-050/RF-051.

## Ngoài phạm vi

- Zalo, SMS, push notification hoặc thêm provider mới.
- Gọi provider trực tiếp trong API request.
- Operations/dead-letter UI và manual retry của RF-053.
- Webhook delivery/open/click.
- Thay đổi OpenAPI, Prisma schema hoặc migration.
- Gửi email cho phiếu không có email trong intake snapshot.

## Internal event contract

### Ready for pickup

```json
{
  "repairOrderId": "uuid",
  "channel": "EMAIL",
  "templateKey": "REPAIR_ORDER_READY_V1"
}
```

Aggregate là `REPAIR_ORDER/{repairOrderId}`. Event và delivery được tạo sau khi state machine đã cập nhật status, trong cùng transaction.

### Handover completed

```json
{
  "repairOrderId": "uuid",
  "status": "COMPLETED",
  "completionOutcome": "REPAIRED",
  "handedOverAt": "ISO-8601",
  "hasWarranty": true,
  "tokenRecordId": "uuid",
  "tokenScope": "TRACK_ORDER",
  "expiresAt": "ISO-8601",
  "channel": "EMAIL",
  "templateKey": "HANDOVER_COMPLETED_V1"
}
```

Aggregate là `REPAIR_ORDER/{repairOrderId}`. Token record, outbox và delivery được tạo cùng handover/payment/warranty/status transition.

### Staff invitation

```json
{
  "invitationId": "uuid",
  "expiresAt": "ISO-8601",
  "channel": "EMAIL",
  "templateKey": "STAFF_INVITATION_V1"
}
```

Aggregate là `STAFF_INVITATION/{invitationId}`. Create và reissue tạo event riêng gắn với invitation record mới.

## Transaction boundary

- Ready: `RepairOrder.status`, timeline event, outbox và delivery cùng transaction state-machine/idempotency.
- Handover: payment, handover, warranty, token revoke/create, status, timeline/audit, outbox và delivery cùng transaction handover/idempotency.
- Staff invitation: invitation row, audit, outbox, delivery và idempotency record cùng transaction.
- Bất kỳ insert outbox/delivery nào lỗi phải rollback toàn bộ business action.

## Tenant, destination và token rules

1. `OutboxEvent.shopId` là tenant authority; resolver không nhận `shopId` từ payload.
2. Repair-order destination chỉ lấy từ immutable `RepairOrder.customerSnapshot.email`, không lấy từ `Customer.email` hiện tại.
3. Staff destination chỉ lấy từ persisted `StaffInvitation.email` của đúng invitation/tenant.
4. Worker chuẩn hóa destination, HMAC và so sánh constant-time với `NotificationDelivery.destinationHash` trước khi gửi.
5. Handover token phải là `TRACK_ORDER`, đúng shop/order/record/expiry, chưa revoke và hash phải khớp token tái tạo.
6. Invitation phải còn `PENDING`, chưa hết hạn, đúng shop/aggregate/expiry và token hash phải khớp token tái tạo.
7. Event stale, cross-tenant, payload sai, destination mismatch hoặc token invalid là permanent failure với safe error code.
8. Outbox, delivery, audit và log không chứa recipient, raw token, public URL, credentials hoặc provider body.

## File ownership dự kiến

- `docs/tasks/milestone-6/RF-052-notification-orchestration.md`
- `packages/security/src/**`
- `apps/api/src/modules/notifications/**`
- `apps/api/src/modules/repair-orders/state-machine/**`
- `apps/api/src/modules/handovers/**`
- `apps/api/src/modules/staff-memberships/**`
- API integration tests liên quan
- `apps/worker/src/index.ts`
- `apps/worker/src/outbox/**`

## Dependencies

- RF-036 tạo `QUOTE_SENT` và quote delivery.
- RF-039 cung cấp staff invitation lifecycle.
- RF-041/RF-047 cung cấp ready/handover transactions.
- RF-050 cung cấp claim/lease/retry/dead-letter.
- RF-051 cung cấp EMAIL adapter, immutable resolver và shared security primitives.

## Acceptance criteria

- [ ] Request path không import/call provider.
- [ ] Ready, handover và staff invite/reissue tạo outbox + EMAIL delivery trong đúng business transaction.
- [ ] Business state rollback nếu outbox/delivery insert lỗi.
- [ ] Worker allowlist đúng bốn event và channel EMAIL hiện có.
- [ ] Resolver tenant-bound và dùng immutable destination source.
- [ ] Handover/invitation link chỉ được tạo trong RAM sau token integrity check.
- [ ] Accepted/revoked/superseded/expired invitation không được gửi.
- [ ] Phiếu không có snapshot email không tạo notification job.
- [ ] Raw token, public URL và recipient không nằm trong outbox/delivery/audit/log.
- [ ] Template escape dữ liệu động và chỉ hiển thị dữ liệu customer-safe.
- [ ] Zalo/SMS vẫn pending và không bị worker EMAIL claim.
- [ ] Không đổi OpenAPI/Prisma schema/migration.

## Test

- API: atomic outbox/delivery cho ready, handover, invite/reissue; rollback; idempotent replay; immutable snapshot; payload không chứa destination/raw token.
- Resolver: success cho ba event mới; tenant/aggregate mismatch; destination mismatch; expired/revoked/tampered track token; stale invitation lifecycle; payload/template mismatch.
- Template: escaping, customer-safe content và link đúng scope.
- Regression: quote email, claim/retry/dead-letter/provider idempotency.

## Definition of Done

- Acceptance criteria và test nêu trên đạt.
- `format:check`, `lint`, `typecheck`, full test và `build` đạt.
- `prisma validate` và migration status xác nhận không có schema change.
- Git diff chỉ thuộc RF-052; chưa commit/push.

## AI implementation prompt

Bạn đang làm RF-052 — Notification orchestration trong `C:\RepairFlow`.

Đọc `AGENTS.md`, `docs/tasks/milestone-6/README.md`, file RF này, product spec, domain rules, architecture, RBAC, Prisma schema, error codes và testing strategy. Tóm tắt transaction boundary, event contract, tenant/destination resolution, token lifecycle, claim allowlist và secret-handling trước khi code.

Giữ `QUOTE_SENT` hiện có; triển khai transactional outbox + EMAIL delivery cho ready-for-pickup, handover và staff invitation create/reissue. Worker resolve context tenant-bound, dùng intake snapshot/invitation record, verify destination HMAC, tái tạo TRACK/invitation token trong RAM và verify persisted hash trước khi render. Không gọi provider trong request; không persist/log recipient, raw token, public URL, credential hoặc provider body. Không triển khai Zalo/SMS, RF-053 operations, webhook, OpenAPI hay migration.

Viết test cho atomic success/rollback/replay, snapshot immutability, cross-tenant/context mismatch, malformed payload, destination mismatch, expired/revoked/tampered token, stale invitation, escaping và RF-050/RF-051 regressions. Chạy format, lint, typecheck, test, build và migration checks. Không commit hoặc push.
