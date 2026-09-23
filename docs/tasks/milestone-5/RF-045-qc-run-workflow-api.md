# RF-045 — Append-only QC run and readiness API

## Objective

Record complete QC evidence against an immutable template version, derive the result on the server, return failed work to repair atomically, and enforce the passing-QC gate before pickup readiness.

## Scope

- Implement idempotent QC-run submission with complete result coverage and optional verified evidence media.
- Allocate a monotonic per-order `runNo` and advance repair-order optimistic versioning for every committed run.
- Derive `PASS` or `FAIL` on the server from the selected active template version.
- On failure, append the run/results/events and transition `QUALITY_CHECK -> REPAIRING` in one transaction.
- On pass, keep the order in `QUALITY_CHECK` and allow the separate RF-041 transition to `READY_FOR_PICKUP` with outcome `REPAIRED`.
- Expose immutable QC-run history, exact template version/items, result details, notes, and safe media metadata in staff repair-order detail.
- Integrate the latest-run guard with the central state-machine service.

## Outside scope

- QC-template management, Work-tab behavior, payments, handover, warranty, frontend UI, real notifications, or AI suggestions.
- Editing/deleting a QC run or overriding a failed result.
- Automatic second-person separation, which is not part of the current RBAC contract.

## Submission flow

1. Validate tenant, actor, DTO, idempotency key, and `expectedLockVersion`.
2. Verify referenced evidence uploads are complete, unexpired, same-shop/order, allowed MIME/size, and purpose `QC`.
3. Begin one transaction and acquire the per-order lock.
4. Re-read order state, lock version, active assignment, template/version, template items, and previous QC history.
5. Require `QUALITY_CHECK`, owner or actively assigned technician, and an active tenant-owned template.
6. Require each template item exactly once, reject duplicates/foreign items, and enforce `NOT_APPLICABLE` only when `allowNa`.
7. Derive the overall result. Any `FAIL` requires a non-blank run-level failure note.
8. Under the order lock, allocate `runNo = previous max + 1` for that order and insert the immutable run, results, evidence links, and `qc.completed` event.
9. Advance `RepairOrder.lockVersion` exactly once for every accepted submission. A failed run does so through the central state-machine transition to `REPAIRING`; a passed run performs an optimistic compare-and-increment while keeping `QUALITY_CHECK`.
10. Return the new `runNo` and updated order `lockVersion`, store the idempotent response, and commit. Any error rolls back every record, version, event, evidence binding, and status change.

## Business and security rules

- Owner may submit QC for any order in the active shop. Technician must have the active assignment. Receptionist cannot submit QC.
- Cross-tenant order, template, template item, or media behaves as not found.
- Every template item is snapshotted by immutable template-version reference and result; later template versions do not alter history.
- A run is `PASS` only when no item failed, every required item passed, and every `NOT_APPLICABLE` value is explicitly allowed.
- The latest run is the greatest tenant/order-scoped monotonic `runNo`, allocated under the same order lock. Timestamp and random UUID are display/tie-break metadata only and never decide readiness. An older pass cannot override a later fail.
- Every successful QC submission increments the order `lockVersion`, including `PASS` while status remains `QUALITY_CHECK`. Two submissions carrying the same expected version cannot both commit under different idempotency keys.
- Failed QC must transition back to `REPAIRING`; no override endpoint exists.
- A passed run does not itself mark the order ready. Owner, receptionist, or actively assigned technician uses the guarded transition from RF-041.
- Outcome `REPAIRED` and `readyAt` are server-owned.
- Public events contain only customer-safe progress and never checklist notes, staff IDs, object keys, or internal evidence metadata.

## API/UI involved

- `POST /api/v1/repair-orders/{repairOrderId}/qc-runs`
- `POST /api/v1/repair-orders/{repairOrderId}/transition` for the separately authorized ready command
- Order-bound media presign/verification contract for purpose `QC`
- Expanded staff repair-order detail QC history
- No UI in this RF.

## Expected files and ownership

- `apps/api/src/modules/quality-control/runs/**`
- Quality-control module composition files
- Order-scoped media verification/binding files required by the frozen contract
- `apps/api/src/modules/repair-orders/repair-order.types.ts`
- `apps/api/src/modules/repair-orders/repair-orders.repository.ts`
- Focused state-machine repository/service integration only where latest-QC mapping is required
- `apps/api/test/qc-runs.e2e.test.ts`

Do not change QC-template contracts, quote behavior, payments, handover, UI, or public response shapes.

## Dependencies

- RF-040 contract/persistence, RF-041 state-machine foundation, RF-042 work/parts API, and RF-044 QC-template API merged.
- RF-041 supplies `REPAIRING -> QUALITY_CHECK`, failed return, and passing-ready transition guards.

## Acceptance criteria

- Owner and actively assigned technician can submit a complete valid run in `QUALITY_CHECK`.
- Receptionist, unassigned technician, inactive membership, and cross-tenant actors are denied without resource disclosure.
- Result is derived by the server; client cannot submit overall status.
- Failure appends the complete history and returns the order to `REPAIRING` atomically.
- Pass remains in `QUALITY_CHECK`; the ready transition succeeds only for the latest pass and sets `REPAIRED`.
- Template item coverage, `NOT_APPLICABLE`, notes, evidence, stale lock, idempotency, and concurrency follow the frozen contract.
- Detail history remains immutable, ordered by `runNo`, and bound to the exact template version.
- Every accepted run returns a unique sequential `runNo` and the incremented order `lockVersion`; a stale concurrent submission creates no partial history.

## Required tests

- Owner, assigned technician, receptionist, unassigned technician, and inactive membership matrix.
- Shop-A/shop-B order/template/item/media isolation.
- Wrong order state and stale `expectedLockVersion`.
- Missing, duplicate, foreign, or extra results; invalid `NOT_APPLICABLE`; empty failure note.
- Server-derived pass and fail, failed atomic return, passed separate-ready transition, and latest-run precedence.
- Sequential `runNo` allocation, deterministic latest-run reads, PASS lock-version increment without a status change, FAIL transition increment exactly once, and two different keys racing with the same expected version.
- Inactive template for new run and historical inactive-template rendering.
- Evidence purpose, upload completion, expiry, ownership, duplicate IDs, and rollback.
- Same-key replay, payload mismatch, concurrent submissions, and no partial run/results/event/status.
- Public timeline redaction and internal-detail mapping.

## Definition of Done

- QC runs/results and their template versions cannot be edited or deleted through ordinary APIs.
- Status writes go only through the central state-machine service.
- Transaction and idempotency tests prove no split-brain run/status result.
- Format, lint, typecheck, integration tests, full tests, build, and applicable migration checks pass.

## AI implementation prompt

```text
Bạn đang làm RF-045 — Append-only QC run and readiness API trong C:\RepairFlow.
Đọc AGENTS.md, docs/tasks/milestone-5/README.md,
docs/tasks/milestone-5/RF-040-service-contract-persistence.md,
docs/tasks/milestone-5/RF-041-repair-execution-state-machine.md,
docs/tasks/milestone-5/RF-042-work-logs-parts-api.md,
docs/tasks/milestone-5/RF-044-qc-template-api.md,
docs/tasks/milestone-5/RF-045-qc-run-workflow-api.md,
docs/domain-rules.md, docs/rbac.md, docs/openapi.yaml,
prisma/schema.prisma, docs/error-codes.md và docs/testing-strategy.md.

Trước khi code, tóm tắt submit contract, template snapshot, result derivation,
role/assignment, evidence verification, latest-run guard, idempotency, optimistic
concurrency, per-order runNo và transaction. Sau đó triển khai QC run/history:
allocate runNo tăng dần dưới order lock; mọi submission thành công tăng
lockVersion đúng một lần; FAIL ghi run rồi quay về REPAIRING trong cùng
transaction; PASS tăng version nhưng giữ QUALITY_CHECK và chỉ mở guard chuyển
READY_FOR_PICKUP riêng. Latest QC luôn lấy runNo lớn nhất, không dùng timestamp
hoặc random UUID làm causal order.

Không triển khai template management, UI, payment, handover, warranty, real
notification hoặc AI. Test role/tenant, result coverage, N/A, failure notes,
pass/fail, evidence, stale version, latest-run precedence, idempotency,
concurrency, rollback và redaction. Chạy format, lint, typecheck, test, build và
migration checks phù hợp. Không commit hoặc push.
```
