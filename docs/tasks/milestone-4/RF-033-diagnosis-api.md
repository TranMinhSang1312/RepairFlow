# RF-033 — Append-only diagnosis API

## Objective

Allow an assigned technician or owner to publish an auditable diagnosis revision without overwriting earlier technical conclusions.

## Scope

- Implement diagnosis creation and response mapping from the RF-030 contract.
- Allocate `revisionNo` safely under concurrency.
- Validate optional `supersedesId` belongs to the same order and shop.
- Expose ordered diagnosis history through repair-order detail.
- Append a timeline event without exposing private technical detail in its public payload.

## Outside scope

- AI suggestions, attachments, quote creation, assignment, transitions, work logs, and UI.
- Editing or deleting a published diagnosis.

## Flow and transaction

1. Authenticate and establish tenant context.
2. Read the order in the active shop and verify it is in `DIAGNOSING`.
3. Allow owner, or require technician to be the active assignee.
4. Validate `supersedesId` against the same order when supplied.
5. In one transaction, allocate the next revision, insert diagnosis, and append event.
6. Return the created revision.

## Business and security rules

- Receptionist cannot publish a diagnosis.
- Technician cannot diagnose an unassigned or formerly assigned order.
- Diagnosis is append-only; correction creates a new revision.
- `finding` and `recommendation` remain staff-only unless a later explicit customer-summary feature publishes safe text.
- Foreign resources behave as not found.

## API/UI involved

- `POST /api/v1/repair-orders/{repairOrderId}/diagnoses`
- `GET /api/v1/repair-orders/{repairOrderId}` diagnosis history extension
- No UI in this RF.

## Expected files

- `apps/api/src/modules/diagnoses/*`
- `apps/api/src/modules/repair-orders/repair-orders.module.ts`
- Repair-order detail mapper/types
- `apps/api/test/diagnoses.e2e.test.ts`

## Dependencies

- RF-030 and RF-032 merged.
- RF-031 merged for active-assignee checks.

## Acceptance criteria

- Owner and active assigned technician can publish.
- Receptionist, inactive/unassigned technician, wrong state, and cross-tenant actors cannot publish.
- History is ordered by revision and prior content never changes.
- Concurrent creates receive distinct sequential revisions or one clean retryable conflict; duplicates are impossible.
- Public timeline payload does not contain finding or recommendation.

## Required tests

- Role/state/assignment matrix.
- Cross-tenant order and supersedes reference.
- Correction chain and immutable prior revision.
- Concurrent revision allocation.
- Transaction rollback on event failure.
- Repair-order detail mapping and sensitive-data exclusion.

## Definition of Done

- Append-only repository and transactional service are implemented.
- Contract and domain rules match without undocumented fields.
- Format, lint, typecheck, tests, and build pass.

## AI implementation prompt

```text
Bạn đang làm RF-033 — Append-only diagnosis API trong C:\RepairFlow.
Đọc AGENTS.md, docs/tasks/milestone-4/README.md,
docs/tasks/milestone-4/RF-033-diagnosis-api.md, docs/domain-rules.md,
docs/rbac.md, docs/openapi.yaml, prisma/schema.prisma,
docs/error-codes.md và docs/testing-strategy.md.

Trước khi code, tóm tắt diagnosis contract, role/assignment matrix, trạng thái hợp
lệ, revision allocation, supersedes rule, tenant boundary và transaction. Sau đó
triển khai diagnosis API và detail history đúng contract RF-030.

Không triển khai AI, quote, work log hoặc UI. Test owner, assigned technician,
receptionist denied, unassigned/inactive technician, wrong state, cross-tenant,
supersedes mismatch, concurrency, rollback và sensitive-data exclusion. Chạy toàn
bộ kiểm tra phù hợp. Không commit hoặc push.
```
