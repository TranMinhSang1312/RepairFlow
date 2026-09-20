# RF-032 — Repair-order state-machine foundation

## Objective

Provide the single authoritative service and endpoint through which repair-order status changes occur, beginning with transitions needed by assignment, diagnosis, and quote approval.

## Scope

- Implement `POST /api/v1/repair-orders/{repairOrderId}/transition`.
- Centralize transition graph, role checks, guard checks, optimistic locking, event creation, and idempotency.
- Support staff-initiated transitions required before quote decision: `RECEIVED → DIAGNOSING`, owner-only `RECEIVED → VOIDED`, and explicitly contracted returns to `DIAGNOSING`.
- Expose an internal transition service that RF-036 and RF-037 can call inside their transactions.

## Outside scope

- Assignment creation, diagnosis records, quote records, public decisions, work, QC, handover, or UI.
- Implementing future transitions whose guard data does not yet exist.

## Transaction boundary

1. Resolve idempotency key and request hash within the tenant scope.
2. Read/lock the order and compare `expectedLockVersion`.
3. Verify actor capability and allowed edge.
4. Re-read assignment/intake evidence and other required guards.
5. Update status/outcome/timestamps and increment `lockVersion`.
6. Append `OrderEvent` and any required outbox record.
7. Persist the idempotent response and commit atomically.

## Business and security rules

- No controller or repository may patch `status` directly.
- `RECEIVED → DIAGNOSING` requires intake condition, required uploaded photos, and an active technician.
- `RECEIVED → VOIDED` is owner-only and requires no quote, payment, or work history.
- Stale `expectedLockVersion` is a conflict and leaves no event.
- Cross-tenant resources return not found.
- Unsupported edges return the documented invalid-transition error.

## API/UI involved

- `POST /api/v1/repair-orders/{repairOrderId}/transition`
- Updated repair-order response/timeline.
- No UI in this RF.

## Expected files

- `apps/api/src/modules/repair-orders/state-machine/*`
- `apps/api/src/modules/repair-orders/repair-orders.controller.ts`
- `apps/api/src/modules/repair-orders/repair-orders.service.ts`
- `apps/api/src/modules/repair-orders/repair-orders.repository.ts`
- `apps/api/test/repair-order-transitions.e2e.test.ts`

## Dependencies

- RF-030 merged.
- RF-031 is required for the successful `RECEIVED → DIAGNOSING` scenario but may be developed concurrently using fixtures.

## Acceptance criteria

- Supported transitions commit status, lock version, event, and idempotency record atomically.
- Every rejected guard rolls back completely.
- Same key/same payload returns the original response; same key/different payload is rejected.
- Concurrent requests cannot both win from one lock version.
- Internal callers can participate in a surrounding transaction without nested partial commits.

## Required tests

- Every allowed edge in scope and every rejected source/target combination.
- Missing assignment/intake evidence.
- Owner-only void and history guards.
- Role and cross-tenant isolation.
- Stale lock, concurrent transition, idempotent retry, and payload mismatch.
- Rollback when event/idempotency persistence fails.

## Definition of Done

- One state-machine service owns all status mutation.
- Status is not assigned anywhere else in the touched runtime code.
- Format, lint, typecheck, tests, and build pass.

## AI implementation prompt

```text
Bạn đang làm RF-032 — Repair-order state-machine foundation trong C:\RepairFlow.
Đọc AGENTS.md, docs/tasks/milestone-4/README.md,
docs/tasks/milestone-4/RF-032-state-machine-foundation.md,
docs/domain-rules.md, docs/rbac.md, docs/openapi.yaml,
prisma/schema.prisma, docs/error-codes.md và docs/testing-strategy.md.

Trước khi code, tóm tắt transition graph thuộc scope, guard, optimistic lock,
idempotency, transaction boundary và quyền. Sau đó triển khai endpoint và domain
service duy nhất cho status transition, chỉ với các edge đã có dữ liệu guard.

Không triển khai assignment, diagnosis, quote, public decision, work, QC hoặc UI.
Viết test cho allowed/rejected edges, role, tenant, evidence, stale lock,
concurrency, idempotency và rollback. Chạy format, lint, typecheck, test và build.
Không commit hoặc push.
```
