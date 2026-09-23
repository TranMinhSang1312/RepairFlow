# RF-042 — Approved-scope work logs and parts API

## Objective

Allow an owner or the actively assigned technician to record repair work, coordinate required-part availability, and append immutable used-part snapshots without exceeding the customer's approved scope.

## Scope

- Implement append-only work-log creation and correction.
- Implement part-requirement creation and guarded availability updates.
- Implement append-only used-part snapshot creation and correction according to the RF-040 contract.
- Enforce the current binding approval snapshot for all technical work and parts.
- Resolve carried-forward replacement items through RF-040's stable scope lineage instead of matching editable descriptions or prices.
- Expose approved scope, ordered work logs, part requirements, and used parts in staff repair-order detail.
- Append private/customer-safe timeline payloads according to the frozen allowlist.

## Outside scope

- Adding new state-machine edges or changing transition guards owned by RF-041.
- Creating/sending a replacement quote, QC, payments, handover, warranty, UI, inventory, or supplier management.
- Editing or deleting existing work logs or used-part snapshots.
- Allowing an owner or client to bypass approval with a free-text “no charge” flag.

## Flow and transaction boundaries

### Work log

1. Parse tenant, actor, order ID, idempotency key, and DTO.
2. Lock the repair order and re-read state, active assignment, and latest binding approval.
3. Validate the exact type/state rule, approved item, and optional correction target. For `CORRECTION`, resolve the immutable chain to its root semantic type/binding and require the target to be the current effective leaf.
4. Append the work log and timeline event in one transaction.
5. Persist the idempotent response and return the concrete `WorkLog` representation.

### Part requirement

1. Validate an approved `PART` item from the current approval snapshot.
2. Create the requirement in server-owned state `NEEDED` with immutable part identity/quantity.
3. Staff availability updates allow only `NEEDED -> ORDERED`, `NEEDED -> AVAILABLE`, or `ORDERED -> AVAILABLE`; they check the requirement version, update it, and append an event atomically.
4. Do not expose `CANCELLED` as staff input. RF-041 alone applies terminal system cancellation when replacement-quote acceptance removes a lineage.

### Used part

1. Re-read order state and approved `PART` scope under the order lock.
2. Validate `REPAIRING`, positive quantity, non-negative integer-VND prices, cumulative approved quantity, and optional same-order correction target. A correction must target the current effective leaf and replaces that snapshot in cumulative-quantity calculation.
3. Append the snapshot and event atomically; never recalculate the quote or payment balance from this snapshot.

## Business and security rules

- Owner may mutate any order in the active shop. Technician requires an active membership and active assignment for the order. Receptionist is read-only for execution records.
- Foreign order, quote item, requirement, or superseded record behaves as not found.
- `REPAIR` and `TEST` are allowed only in `REPAIRING` and require an approved item ID.
- `CUSTOMER_CONTACT` and `INTERNAL_NOTE` are allowed only in `APPROVED`, `WAITING_PARTS`, `REPAIRING`, `QUALITY_CHECK`, or `READY_FOR_PICKUP`; they never satisfy approved-scope coverage.
- A correction of `REPAIR`/`TEST` is allowed only in `REPAIRING`. A correction of `CUSTOMER_CONTACT`/`INTERNAL_NOTE` is allowed only in those same five operational states. It must target one same-order current leaf, cannot branch or cycle, and inherits the chain's root semantic type and quote-item/scope binding.
- No work-log, requirement, availability, or parts-used write is allowed in `AWAITING_APPROVAL`. No execution write is allowed in `RECEIVED`, `DIAGNOSING`, `COMPLETED`, or `VOIDED`.
- A technical record cannot bind to an unselected optional item, unrelated superseded scope, draft quote, another order, or another shop. Prior evidence counts for a replacement item only through the validated stable lineage established by RF-041; this RF never infers lineage from text or price.
- Part-requirement create/update is allowed only in `APPROVED`, `WAITING_PARTS`, or `REPAIRING` and only for a current approved `PART` scope. There is at most one current requirement per order/scope, missing data is not “available,” and availability is not an inventory count. `CANCELLED` is system-only, terminal, excluded from current-scope guards, and cannot be selected through these APIs.
- Used-part append/correction is allowed only in `REPAIRING`. Snapshots are append-only; a correction is another snapshot linked through `supersedesId`, and only the latest linear descendant contributes quantity/cost/sale-price evidence. The superseded snapshot remains readable but is not double-counted.
- Internal costs and internal notes never enter public payloads or public API responses.
- A selected zero-price quote item is the only Milestone 5 representation of authorized no-charge work.

## API/UI involved

- `POST /api/v1/repair-orders/{repairOrderId}/work-logs`
- `POST /api/v1/repair-orders/{repairOrderId}/part-requirements`
- `PATCH /api/v1/part-requirements/{partRequirementId}`
- `POST /api/v1/repair-orders/{repairOrderId}/parts-used`
- Expanded `GET /api/v1/repair-orders/{repairOrderId}` mapping
- No UI in this RF.

Exact request/response names and idempotency headers follow the OpenAPI contract frozen by RF-040.

## Expected files and ownership

- `apps/api/src/modules/service-execution/**` or clearly separated `work-logs/**` and `parts/**` submodules
- DTO, types, controller, service, repository, and module files for the above operations
- `apps/api/src/modules/repair-orders/repair-order.types.ts`
- `apps/api/src/modules/repair-orders/repair-orders.repository.ts`
- `apps/api/src/modules/repair-orders/repair-orders.module.ts`
- Permission/capability definitions and focused role tests
- `apps/api/test/work-logs-parts.e2e.test.ts`

Do not edit `docs/openapi.yaml` or `prisma/schema.prisma` unless an actual RF-040 defect is fixed with all affected consumers.

## Dependencies

- RF-040 contract and persistence alignment merged.
- RF-041 repair-execution state-machine foundation merged.

## Acceptance criteria

- Owner and actively assigned technician can append valid work and part records.
- Receptionist, inactive/unassigned technician, and cross-tenant actor cannot mutate them.
- Approved scope is derived from `QuoteApproval.approvedItemSnapshot`; partial acceptance excludes unselected options.
- Technical logs and used parts outside current approved scope are rejected with stable error codes.
- Corrections preserve original records, inherit root semantics/binding, replace superseded effective evidence, and cannot cross order/shop, branch, or create cycles.
- Every command enforces RF-040's exact state matrix; no execution mutation succeeds while approval is pending or after custody is terminal.
- Requirement lifecycle updates use optimistic concurrency, expose only staff edges `NEEDED -> ORDERED|AVAILABLE` and `ORDERED -> AVAILABLE`, and never allow staff cancellation.
- Detail mapping is ordered, complete, BigInt/Decimal safe, and does not expose private fields publicly.
- A failed operation leaves no partial log, part, event, or idempotency record.

## Required tests

- Owner and assigned-technician success; receptionist and unassigned-technician denial.
- Inactive membership and shop-A/shop-B not-found behavior.
- Every allowed and rejected state for `REPAIR`, `TEST`, `CUSTOMER_CONTACT`, `INTERNAL_NOTE`, their corrections, requirement create/update, and parts-used append/correction, including complete rejection during `AWAITING_APPROVAL`.
- Accepted, partially accepted, unselected, superseded, foreign-order, and foreign-shop quote items.
- Valid correction by root semantic type, missing/non-leaf target, double superseder, cross-order target, branch/cycle rejection, and proof that only the latest descendant satisfies coverage.
- Part requirement lifecycle, rejected staff `CANCELLED`, terminal system-cancelled read behavior, stale version, concurrent availability updates, and exclusion of cancelled requirements from current guards.
- Positive decimal quantities, integer-VND boundaries, non-negative cost/sale price, and cumulative approved quantity with replacement rather than double-counting across a correction chain.
- Same-key replay, key/payload mismatch, concurrent duplicate request, and transaction rollback.
- Detail ordering, sensitive cost/public payload filtering, and BigInt/Decimal serialization.

## Definition of Done

- Controllers are thin and all ownership/scope decisions live in application/domain services.
- Every repository query is tenant-scoped and every new tenant path has a negative cross-shop test.
- Work logs and used-part history cannot be updated or deleted through ordinary APIs.
- Format, lint, typecheck, relevant integration tests, full tests, and build pass.

## AI implementation prompt

```text
Bạn đang làm RF-042 — Approved-scope work logs and parts API trong
C:\RepairFlow. Đọc AGENTS.md, docs/tasks/milestone-5/README.md,
docs/tasks/milestone-5/RF-040-service-contract-persistence.md,
docs/tasks/milestone-5/RF-041-repair-execution-state-machine.md,
docs/tasks/milestone-5/RF-042-work-logs-parts-api.md, docs/domain-rules.md,
docs/rbac.md, docs/openapi.yaml, prisma/schema.prisma, docs/error-codes.md và
docs/testing-strategy.md.

Trước khi code, tóm tắt approved-scope source, state/type matrix, assignment và
tenant rules, correction semantics, part-requirement lifecycle, used-part money
rules, idempotency và transaction boundaries. Sau đó triển khai work logs, part
requirements/availability, used-part snapshots và staff detail mapping đúng
contract RF-040.

Áp dụng chính xác state matrix: REPAIR/TEST và correction của chúng chỉ ở
REPAIRING; CUSTOMER_CONTACT/INTERNAL_NOTE và correction chỉ ở APPROVED,
WAITING_PARTS, REPAIRING, QUALITY_CHECK, READY_FOR_PICKUP; requirement chỉ ở
APPROVED/WAITING_PARTS/REPAIRING; parts-used chỉ ở REPAIRING; không execution
write khi AWAITING_APPROVAL. Correction kế thừa root semantic type/binding, chỉ
leaf mới effective; used-part correction thay thế quantity cũ khi cộng dồn.
Staff chỉ được NEEDED->ORDERED|AVAILABLE hoặc ORDERED->AVAILABLE; CANCELLED là
system-only do RF-041 reconciliation và không bao giờ là input của API này.

Không sửa state graph của RF-041, không triển khai quote send, QC, payment,
handover, warranty, inventory hoặc UI. Test role/assignment, cross-tenant,
partial approval, wrong state, corrections, part lifecycle, money/quantity,
concurrency, retry/mismatch, rollback và sensitive-data filtering. Chạy format,
lint, typecheck, test và build. Không commit hoặc push.
```
