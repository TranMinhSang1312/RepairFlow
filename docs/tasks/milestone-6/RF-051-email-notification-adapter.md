# RF-051 — Email notification adapter and immutable resolution

## Mục tiêu

Biến `QUOTE_SENT` có `NotificationDelivery.channel=EMAIL` thành email thật qua worker, trong khi request gửi báo giá vẫn chỉ commit transaction/outbox. Địa chỉ nhận, template và public link phải được giải quyết từ dữ liệu bất biến, có kiểm tra toàn vẹn và không làm lộ destination, raw token hoặc provider credential vào database/log.

## Kết quả nghiệp vụ

- Khách hàng nhận được email báo giá chứa đúng mã phiếu, thiết bị, tổng tiền, hạn phản hồi và public link.
- Retry dùng cùng provider idempotency key nên không tạo một email logic mới.
- Việc sửa hồ sơ `Customer` sau tiếp nhận không đổi nơi nhận của thông báo đã xếp hàng; worker dùng `RepairOrder.customerSnapshot`.
- Job có context, tenant, destination hash hoặc token không hợp lệ vào dead letter ngay với safe error code.
- Lỗi mạng, timeout, `408`, `409`, `425`, `429` và `5xx` được retry theo backoff RF-050.

## Phạm vi

1. Thêm package Node-only `@repairflow/security` để API và worker dùng cùng thuật toán:
   - sinh quote/track public token;
   - hash raw token;
   - chuẩn hóa và hash notification destination;
   - so sánh hash constant-time;
   - tạo public URL.
2. Gắn `templateKey=QUOTE_SENT_V1` vào payload outbox mới. Job cũ không có key được đọc theo compatibility mapping sang `QUOTE_SENT_V1`.
3. Worker chỉ claim event có delivery thuộc channel `EMAIL`; delivery channel chưa hỗ trợ vẫn để pending.
4. Resolve tenant-bound context từ `OutboxEvent`, `QuoteVersion`, `RepairOrder.customerSnapshot`, `Shop` và `PublicAccessToken`.
5. Kiểm tra scope, binding, expiry, revocation, token hash và destination hash trước khi render.
6. Render text/HTML customer-safe và escape mọi dữ liệu snapshot do người dùng nhập.
7. Gửi qua Resend REST API với provider `Idempotency-Key` ổn định.
8. Cấu hình worker cho public-token derivation và Resend.

## Ngoài phạm vi

- Zalo, SMS, push notification.
- Event `READY_FOR_PICKUP`, handover, warranty hoặc staff invitation; RF-052 sở hữu orchestration đó.
- UI/API vận hành dead letter và manual retry; RF-053 sở hữu.
- Webhook delivery/open/click và đồng bộ trạng thái từ provider.
- Thay đổi OpenAPI, Prisma schema hoặc migration.

## Contract nội bộ

### Outbox input

Worker nhận `QUOTE_SENT` / `QUOTE_VERSION` với payload:

```json
{
  "repairOrderId": "uuid",
  "quoteVersionId": "uuid",
  "tokenRecordId": "uuid",
  "tokenScope": "DECIDE_QUOTE",
  "channel": "EMAIL",
  "templateKey": "QUOTE_SENT_V1",
  "expiresAt": "ISO-8601"
}
```

Payload chỉ chứa identifier và metadata không bí mật. Raw public token và email không được ghi vào payload.

### Provider request

Adapter gọi `POST https://api.resend.com/emails` (có thể override bằng `RESEND_API_URL`) với Bearer credential, JSON `from`, `to`, `subject`, `text`, `html`, optional `reply_to`, và header `Idempotency-Key=outbox:{eventId}:notification:{deliveryId}`. Resend hỗ trợ idempotency cho `POST /emails`; cùng key và payload trả cùng email ID trong cửa sổ provider ([Resend idempotency documentation](https://resend.com/changelog/idempotency-keys)).

Chỉ `providerMessageId` được lưu sau thành công. Response body, request body, email và token không được log.

## Resolution và tenant rules

1. `event.shopId` là tenant authority của worker job.
2. `QuoteVersion` phải khớp đồng thời `id=aggregateId`, `shopId` và `repairOrderId` trong payload.
3. `PublicAccessToken` phải khớp `id`, `shopId`, `repairOrderId`, `quoteVersionId`, scope `DECIDE_QUOTE`, chưa revoke và chưa hết hạn.
4. `payload.expiresAt` phải khớp chính xác persisted token expiry.
5. Raw token được tái tạo trong RAM từ stable metadata bằng shared PRF; SHA-256 của kết quả phải khớp `tokenHash` đã lưu.
6. Email được chuẩn hóa từ `RepairOrder.customerSnapshot.email`; HMAC của email phải khớp `NotificationDelivery.destinationHash` bằng constant-time comparison.
7. Không đọc destination từ `Customer.email`, payload hoặc dữ liệu do provider trả về.
8. Template chọn bằng allowlist versioned key; không render template name tùy ý từ payload.

## Cấu hình

- `PUBLIC_TOKEN_SECRET` (production bắt buộc) hoặc `ACCESS_TOKEN_SECRET` fallback ở local/test.
- `PUBLIC_WEB_URL`.
- `WORKER_NOTIFICATION_PROVIDER=fake|email`; production cấm `fake`.
- Khi chọn `email`: `RESEND_API_KEY` và `RESEND_FROM_EMAIL` bắt buộc.
- Optional: `RESEND_REPLY_TO_EMAIL`, `RESEND_API_URL`, `RESEND_TIMEOUT_MS`.

## Error policy

Permanent, dead-letter ngay: unsupported event/channel/template, payload/context/tenant mismatch, destination thiếu hoặc hash mismatch, token invalid/expired/integrity failure, provider `4xx` không thuộc retry allowlist.

Retryable: network unavailable, timeout, invalid success response, `408`, `409`, `425`, `429`, `5xx`. Mọi persisted/logged error chỉ là uppercase safe code.

## File ownership dự kiến

- `packages/security/**`
- `packages/config/src/index.ts` và test
- `apps/api/src/modules/public-access/public-token.service.ts`
- `apps/api/src/modules/notifications/fake-notification.adapter.ts`
- `apps/api/src/modules/quotes/quotes.repository.ts`
- `apps/worker/src/outbox/**`
- `apps/worker/src/index.ts`
- `.env.example`, workspace package manifests/lockfile và tài liệu RF này

## Dependencies

- RF-036 tạo token hash, destination hash và notification delivery trong transaction gửi báo giá.
- RF-050 cung cấp claim/lease/retry/dead-letter/idempotent completion.

## Acceptance criteria

- [ ] API và worker dùng chung một implementation PRF/hash; các public URL hiện có không đổi.
- [ ] Worker email chỉ claim event có delivery channel được hỗ trợ.
- [ ] Message lấy recipient từ immutable intake snapshot và verify destination HMAC.
- [ ] Quote/token/order lookup đều tenant-bound và binding mismatch không gọi provider.
- [ ] Token revoked/expired/hash mismatch không được gửi.
- [ ] Template V1 render đúng tổng tiền authoritative và escape dữ liệu động.
- [ ] Resend adapter gửi stable idempotency key và chỉ lưu provider message ID.
- [ ] Provider transient error retry; permanent error dead-letter ngay.
- [ ] Raw token, recipient, API key, request/response body không nằm trong DB/outbox/log.
- [ ] Fake provider vẫn deterministic cho local/test và bị cấm ở production.
- [ ] Không thay đổi OpenAPI/Prisma schema/migration.

## Test

- Shared crypto deterministic/purpose separation/normalization/hash comparison.
- Resolver success, immutable destination, tenant-bound query, malformed payload, destination mismatch, revoked/expired/hash-mismatch token.
- Template escaping và customer-safe fields.
- Resend success/idempotency headers/body, retryable status, permanent rejection, network, timeout, invalid response.
- Worker claim concurrency/retry/dead-letter/lease/idempotent completion regression từ RF-050.
- API quote-send regression chứng minh raw token/destination vẫn không được persist.

## Definition of Done

- Acceptance criteria và test nêu trên đạt.
- `format:check`, `lint`, `typecheck`, full test và `build` đạt.
- Prisma validate/migration status không thay đổi.
- Git diff chỉ thuộc RF-051; chưa commit/push cho đến khi được yêu cầu.

## AI implementation prompt

Bạn đang làm RF-051 — Email notification adapter and immutable resolution trong `C:\RepairFlow`.

Đọc `AGENTS.md`, `docs/tasks/milestone-6/README.md`, file RF này, product spec, domain rules, architecture, RBAC, Prisma schema, error codes và testing strategy. Tóm tắt outbox input, immutable resolution, tenant/token integrity, provider idempotency, retry/permanent failure và secret-handling trước khi code.

Triển khai shared Node security primitives, versioned `QUOTE_SENT_V1` payload/template, tenant-bound resolver dùng intake customer snapshot, token re-derivation/integrity check, EMAIL-only claim boundary và Resend REST adapter. Giữ deterministic fake ngoài production. Raw token/email/API key/provider body không được persist hoặc log. Không triển khai các event/channel RF-052, operations UI/API RF-053, webhook, OpenAPI hay migration.

Viết test cho success, snapshot immutability, cross-tenant/context mismatch, malformed payload, destination hash mismatch, revoked/expired/tampered token, HTML escaping, provider status/network/timeout/idempotency và RF-050 regressions. Chạy format, lint, typecheck, test, build và migration checks. Không commit hoặc push.
