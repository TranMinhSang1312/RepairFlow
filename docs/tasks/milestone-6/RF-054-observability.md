# RF-054 — Structured errors, worker metrics, health and alert boundaries

## Mục tiêu

Cho phép runtime và nền tảng triển khai xác định process còn sống, dependency cốt lõi đã sẵn sàng, worker có đang xử lý ổn định và khi nào cần cảnh báo, đồng thời không đưa dữ liệu khách hàng hoặc bí mật vào telemetry.

## Contract

### API probes

- `GET /api/v1/health` giữ contract foundation hiện tại.
- `GET /api/v1/health/live` chỉ chứng minh process API đang phản hồi; không gọi PostgreSQL hoặc provider.
- `GET /api/v1/health/ready` chạy probe PostgreSQL giới hạn và trả `200` khi sẵn sàng, `503` khi dependency lỗi.
- Probe chỉ trả tên service, version, timestamp, status và trạng thái component allowlist; không trả URL, credential, exception, hostname hoặc chi tiết kết nối.

### Worker operations server

- Worker mở HTTP server nội bộ trên `WORKER_HEALTH_HOST`/`WORKER_HEALTH_PORT`.
- `GET /health/live`: process đang chạy.
- `GET /health/ready`: PostgreSQL truy cập được và worker đã có một poll thành công trong `WORKER_READINESS_STALE_MS`.
- `GET /metrics`: Prometheus text với counter/gauge tổng hợp cho poll, claim, complete, retry, dead-letter, lỗi poll, in-flight và thời điểm poll thành công cuối.
- Path khác trả `404`; method khác `405`. Response có `Cache-Control: no-store`.

## Structured error tracking

- API 5xx phát một event `api.request.error` gồm `service`, `requestId`, HTTP method, route template, status và safe error code.
- Không ghi exception object, message, stack, body, query, headers, URL chứa token, shop/customer identifier hoặc provider body.
- `X-Request-Id` do client cung cấp chỉ được dùng khi khớp safe token pattern và giới hạn chiều dài; giá trị khác được thay bằng UUID server.
- Worker chỉ ghi safe event name, counters, error code và alert reason.

## Alert boundary

- `worker.poll.failures` phát khi số poll lỗi liên tiếp đạt `WORKER_ALERT_FAILURE_THRESHOLD`; chỉ phát một lần cho mỗi chuỗi lỗi và reset sau poll thành công.
- `worker.dead_letters` phát khi một poll tạo ít nhất `WORKER_ALERT_DEAD_LETTER_THRESHOLD` dead-letter.
- RF này không gửi email/SMS/webhook và không gọi alert provider. Hệ thống triển khai có thể route structured alert log hoặc scrape metrics.

## Ngoài phạm vi

- Sentry, Datadog, Grafana, Alertmanager hoặc dashboard được host.
- Per-tenant/per-recipient metric labels.
- Log payload, destination, raw token, provider response hoặc secret.
- Business API, schema Prisma hoặc notification delivery behavior mới.

## File ownership

- `apps/api/src/health/*`, API exception/logging boundary và health tests.
- `apps/worker/src/observability/*`, loop instrumentation, bootstrap và tests.
- `packages/config/src/*`, `packages/contracts/src/*`, `.env.example`.
- `docs/openapi.yaml`, `docs/architecture.md`, `docs/operations/observability.md`.

## Acceptance criteria

- Liveness không phụ thuộc PostgreSQL; readiness phản ánh PostgreSQL và dùng `503` an toàn khi lỗi.
- Worker readiness chuyển unavailable trước poll đầu, sau poll lỗi/stale hoặc DB lỗi; trở lại ok sau poll thành công.
- Metrics tăng chính xác cho success/retry/dead-letter/failure và không chứa dữ liệu nhạy cảm hoặc label cardinality cao.
- Error event API không chứa exception message/stack/body/header/query/token.
- Alert chỉ phát khi qua threshold, không spam trong cùng chuỗi lỗi và không gọi provider.
- Shutdown đóng loop, HTTP server và Prisma có thứ tự.
- OpenAPI, config, runbook và test khớp implementation.

## AI implementation prompt

Triển khai API liveness/readiness, worker operations server, low-cardinality metrics, structured safe error tracker và threshold alert logs theo file này. Không thêm provider/dashboard, không log dữ liệu nhạy cảm và không sửa business flow. Viết unit/integration test cho healthy/unhealthy/stale, metric counters, alert deduplication, safe errors, request-id validation và shutdown. Chạy format, lint, typecheck, test và build. Không commit hoặc push.
