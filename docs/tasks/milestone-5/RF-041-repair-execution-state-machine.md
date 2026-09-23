# RF-041 — Repair-execution state machine and re-quote

## Objective

Complete the authoritative repair-order transition graph for diagnosed non-repair exits, repair execution, waiting parts, quality-control entry/readiness, re-quote, and the handover-only completion boundary without allowing any caller to patch status directly.

## Scope

- Extend the RF-032 state-machine service with the Milestone 5 edges and evidence guards frozen by RF-040.
- Implement staff-command behavior for:
  - `DIAGNOSING → READY_FOR_PICKUP` with outcome `UNREPAIRABLE`, `NO_FAULT_FOUND`, or guarded early `CUSTOMER_CANCELLED`;
  - `APPROVED → WAITING_PARTS`;
  - `APPROVED → REPAIRING`;
  - `WAITING_PARTS → REPAIRING`;
  - `REPAIRING → QUALITY_CHECK`;
  - `QUALITY_CHECK → READY_FOR_PICKUP` with outcome `REPAIRED`.
- Add internal-only transition support for:
  - `REPAIRING → AWAITING_APPROVAL` inside replacement quote send;
  - `QUALITY_CHECK → REPAIRING` inside a failed QC transaction;
  - `READY_FOR_PICKUP → COMPLETED` inside the RF-047 handover transaction.
- Extend draft/send quote eligibility for a full-replacement re-quote from `REPAIRING`.
- Validate stable scope lineage during re-quote and reconcile only valid lineage into the subsequent public-decision approval snapshot.
- Enforce optimistic locking, idempotency for direct transition commands, tenant/role/assignment checks, authoritative guard reads, timeline events, and the outbox boundary.
- Provide transaction-aware internal APIs that RF-045 and RF-047 can call without nested commits.

## Outside scope

- Creating/updating part requirements, work logs, or parts-used records; RF-042 owns those commands.
- Creating QC templates or QC runs; RF-044 and RF-045 own those records.
- Creating payments, handovers, warranties, public tracking tokens, or warranty follow-up orders.
- Work, QC, handover, warranty, or public UI.
- Inventory management or automatic supplier/stock behavior.
- Adding a generic status patch endpoint or accepting status/outcome/timestamps from unrelated request bodies.

## Flow and transaction boundaries

### Direct staff transition

1. Resolve the tenant-scoped idempotency key and canonical request hash according to the existing transition contract.
2. Lock/read the tenant-owned repair order and compare `expectedLockVersion`.
3. Verify active membership, capability, role, and active technician assignment where required.
4. Re-read diagnosis/history evidence, every historical sent/accepted quote, payment/work/part usage, the latest binding `QuoteApproval.approvedItemSnapshot`, part requirements, effective work coverage, latest QC run, and active assignment needed by the requested edge.
5. Validate the graph edge, source state, completion outcome, and all evidence guards.
6. Update status, outcome, `readyAt` where applicable, and `lockVersion` through the central state-machine repository.
7. Append an `OrderEvent` with separate public/private payloads and any contracted outbox event.
8. Persist the idempotent response and commit atomically.

Every rejected role, stale version, unsupported edge, or missing guard leaves status, timestamps, lock version, events, outbox, and idempotency unchanged.

### Replacement quote send

1. The existing quote-send transaction locks the tenant-owned order and draft quote.
2. Require source state `REPAIRING`, owner/receptionist permission, and an earlier binding approval.
3. Recalculate the draft and compare its binding commercial fingerprint with the latest approved full-replacement quote. Scope or price must differ; note/expiry-only changes are insufficient.
4. For every claimed carried scope, require unchanged kind, normalized description, quantity/unit, approval group, and required-versus-optional semantics. Only price and a non-binding display note may differ.
5. Reject invalid, foreign, duplicate, or semantically changed claimed lineage with `QUOTE_SCOPE_LINEAGE_INVALID`; append a redacted audit record while leaving quote/order/approval/work/part state unchanged. New or changed scope receives a new server-owned scope key.
6. Prove structurally that no work or part-used record references unapproved new scope. Earlier approved work remains immutable.
7. Freeze/send the new quote, create its `DECIDE_QUOTE` token and quote records according to RF-036, then call the internal state-machine transition to `AWAITING_APPROVAL` in the same transaction.
8. Commit quote, token hash, status/lock version, timeline, outbox, and idempotency together. The previous accepted quote and approval remain unchanged.

The raw token rules from RF-036 remain in force. Re-quote work in this RF must not persist a token or public URL.

### Public-decision lineage reconciliation

1. When RF-037 records a decision for the replacement quote, resolve each accepted item to the server-owned scope key already validated at send time.
2. Persist that lineage in `QuoteApproval.approvedItemSnapshot`; never infer it from description, client item order, or price similarity during the public request.
3. Carried items retain truthful work/part evidence only through valid lineage. New scope begins with no inherited execution evidence or part readiness.
4. Omitted/unselected scope is no longer current, although its earlier quote, decision, work, and part history remains immutable.
5. If stored lineage metadata is missing/inconsistent, reject reconciliation with `QUOTE_SCOPE_LINEAGE_INVALID`, append a redacted audit record, and roll back decision/status/event/idempotency changes.

### Internal evidence transitions

- RF-045 calls `QUALITY_CHECK → REPAIRING` only after a server-derived failed QC run with failure notes has been staged in the same transaction.
- RF-047 calls `READY_FOR_PICKUP → COMPLETED` only after valid handover/payment/warranty records have been staged in the same transaction.
- Internal callers pass the active Prisma transaction/client and evidence identity. They cannot skip graph, tenant, actor, lock, or guard checks.

## Business, authorization, and security rules

- Only the central state-machine service may mutate `RepairOrder.status`, `completionOutcome`, `readyAt`, `returnedAt`, or `lockVersion`.
- OWNER can execute technical transition actions for any order in the active shop.
- TECHNICIAN can execute technical transitions only with an active assignment to that same order/shop.
- RECEPTIONIST cannot start repair, mark waiting parts, or enter QC. RECEPTIONIST may perform the separate ready transition only after a latest QC pass, as allowed by `docs/rbac.md`, and may send a replacement quote.
- Only OWNER or RECEPTIONIST may perform the non-repair exits from `DIAGNOSING`; technician diagnosis access does not grant pickup/cancellation authority.
- `DIAGNOSING → READY_FOR_PICKUP` with `UNREPAIRABLE` or `NO_FAULT_FOUND` requires at least one tenant/order-bound diagnosis revision. The server sets outcome and `readyAt` atomically.
- `DIAGNOSING → READY_FOR_PICKUP` with `CUSTOMER_CANCELLED` requires a non-blank cancellation note and is permitted only before any quote version has ever reached `SENT`/`ACCEPTED`/`PARTIALLY_ACCEPTED`, and before any payment, technical `REPAIR`/`TEST` work log, or part-used record exists.
- Cancellation guard history is append-only: superseded/revoked quote/token state does not erase the fact that a quote was sent or accepted. Customer contact/internal notes alone do not count as technical work.
- `APPROVED → WAITING_PARTS` requires authoritative approved scope and at least one accepted `PartRequirement` whose state is not `AVAILABLE`.
- `APPROVED → REPAIRING` requires an active assigned technician, non-empty approved scope, and exactly one `AVAILABLE` requirement for every accepted current `PART` scope; a missing requirement does not count as ready.
- `WAITING_PARTS → REPAIRING` requires an active assigned technician and exactly one `AVAILABLE` requirement for every accepted current `PART` scope.
- `REPAIRING → QUALITY_CHECK` requires effective linked `REPAIR`/`TEST` evidence for every actionable `SERVICE` or `PART` item in `QuoteApproval.approvedItemSnapshot`; carried-forward items resolve through RF-040's stable scope lineage and `FEE` items do not require evidence. A directly superseded record no longer counts, while its valid correction inherits the scope binding and becomes effective. Client-provided coverage flags are ignored.
- Stable scope lineage survives only when kind, normalized description, quantity/unit, approval-group membership, and required-versus-optional semantics are unchanged. Only price and a non-binding display note may differ. Every invalid lineage attempt returns `QUOTE_SCOPE_LINEAGE_INVALID` and creates a redacted audit record without partial business mutation.
- `QUALITY_CHECK → READY_FOR_PICKUP` requires the latest QC run to be `PASS`, sets outcome `REPAIRED`, and sets `readyAt` from the server clock. A client cannot choose a different repaired outcome or timestamp.
- `QUALITY_CHECK → REPAIRING` is unavailable through a free-standing staff request; it is committed with the failed QC run and failure notes in RF-045.
- `READY_FOR_PICKUP → COMPLETED` is unavailable through the generic transition endpoint; it is committed only by RF-047 handover.
- Cross-tenant order, quote, approval, part, work-log, QC, or assignment references return not found and reveal no existence.
- The current capability map must use explicit role sets for new technical capabilities. Do not add a capability to a shared set that grants it to RECEPTIONIST accidentally.
- Events/public payloads contain no internal cost, private note, staff email, customer contact detail, raw token, or object key.

## API/UI involved

- Existing `POST /api/v1/repair-orders/{repairOrderId}/transition` with RF-040's frozen request/response and `Idempotency-Key`/`expectedLockVersion` behavior.
- Existing `POST /api/v1/repair-orders/{repairOrderId}/quotes` for a replacement draft in the contracted re-quote source state.
- Existing `POST /api/v1/quotes/{quoteVersionId}/send` for atomic `REPAIRING → AWAITING_APPROVAL`.
- Existing `POST /public/v1/quotes/{token}/decision` receives no new client authority; its server reconciliation persists only lineage validated by the re-quote runtime.
- Internal transaction-aware state-machine API used later by RF-045 and RF-047.
- Repair-order detail/status/timeline mapping only where needed to return the already-contracted transition result.
- No UI changes in this RF.

## Expected files and ownership

RF-041 owns only the following implementation areas:

- `apps/api/src/modules/repair-orders/state-machine/repair-order-transition-graph.ts`
- `apps/api/src/modules/repair-orders/state-machine/repair-order-state-machine.types.ts`
- `apps/api/src/modules/repair-orders/state-machine/repair-order-state-machine.repository.ts`
- `apps/api/src/modules/repair-orders/state-machine/repair-order-state-machine.service.ts`
- `apps/api/src/modules/repair-orders/state-machine/transition-repair-order.dto.ts` only if RF-040 requires generated/validated contract alignment
- `apps/api/src/modules/quotes/quotes.service.ts`
- `apps/api/src/modules/quotes/quotes.repository.ts`
- `apps/api/src/modules/quotes/quote.types.ts` and DTO/controller files only where the frozen re-quote contract requires it
- `apps/api/src/modules/public-portal/public-portal.service.ts`
- `apps/api/src/modules/public-portal/public-portal.repository.ts`
- `apps/api/src/modules/public-portal/public-portal.types.ts` only for approval-snapshot lineage reconciliation
- Existing audit persistence boundary or a focused `apps/api/src/modules/audit/*` implementation required by RF-040's invalid-lineage audit contract
- `apps/api/src/common/permissions/capability.ts`
- `apps/api/test/repair-order-transitions.e2e.test.ts`
- `apps/api/test/quote-send.e2e.test.ts` for re-quote cases
- `apps/api/test/public-quote.e2e.test.ts` for accepted replacement lineage reconciliation
- Focused new unit/integration test files under the same modules when clearer than extending the existing suites

RF-041 must not edit `prisma/schema.prisma`, migrations, or `docs/openapi.yaml`; RF-040 owns those files. It must not add service-execution, QC, payment, handover, warranty, or web modules. While this branch is active, no other RF may edit state-machine files.

## Dependencies

- RF-040 merged, including the frozen Milestone 5 schema, OpenAPI, errors, indexes, and part/work/QC response contracts.
- `docs/tasks/milestone-4/RF-032-state-machine-foundation.md` implementation merged.
- `docs/tasks/milestone-4/RF-035-quote-draft-api.md`, `docs/tasks/milestone-4/RF-036-quote-send-token-outbox.md`, and `docs/tasks/milestone-4/RF-037-public-quote-read-decision.md` implementations merged.
- RF-042, RF-045, and RF-047 depend on this RF's graph/internal transaction API.
- Tests may create RF-040 persistence fixtures directly before RF-042/RF-045 runtime commands exist.

## Acceptance criteria

- Every in-scope edge succeeds only for its exact source state, actor, tenant, assignment, approved-scope, part, work, and QC evidence.
- OWNER/RECEPTIONIST can mark a diagnosed order `UNREPAIRABLE` or `NO_FAULT_FOUND`; missing diagnosis, other roles, and other source states are rejected.
- OWNER/RECEPTIONIST can record `CUSTOMER_CANCELLED` only from `DIAGNOSING` with a non-blank note and no historical sent/accepted quote, payment, technical work, or part usage.
- Direct transitions atomically update status/outcome/timestamps/lock version, event/outbox, and idempotency; any failure rolls everything back.
- Same transition key/payload returns the original result; key reuse with different payload is rejected.
- Concurrent requests from the same `expectedLockVersion` cannot both succeed.
- `APPROVED` cannot enter repair with an unavailable accepted part and cannot enter waiting parts without a non-available accepted requirement.
- `REPAIRING` cannot enter QC until every approved actionable service/part item has item-level effective work evidence.
- An older QC pass cannot satisfy readiness after a later failed run.
- Passing QC does not automatically mark ready; the separate ready transition sets `REPAIRED` and server `readyAt`.
- Failed QC and completion cannot be invoked through the generic endpoint; transaction-aware internal callers remain subject to graph and guard checks.
- A changed full-replacement draft can be sent from `REPAIRING`, preserving prior approval/work history and moving to `AWAITING_APPROVAL` atomically.
- Carried-forward replacement items preserve lineage only when kind, normalized description, quantity/unit, approval-group, and required/optional semantics are unchanged; only price/non-binding display-note changes may reuse truthful evidence.
- Invalid lineage returns `QUOTE_SCOPE_LINEAGE_INVALID`, leaves business state unchanged, and creates a redacted audit record. A later public decision persists the already-validated lineage into its approval snapshot and never infers lineage itself.
- A note-only/expiry-only or otherwise commercially identical replacement is rejected according to the RF-040 error contract.
- No touched path writes status outside the central state-machine service or exposes cross-tenant/sensitive data.

## Required tests

- Each direct allowed edge with OWNER and, where allowed, assigned TECHNICIAN/RECEPTIONIST.
- Denied role matrix, inactive membership, inactive/missing assignment, and foreign-tenant resources.
- `DIAGNOSING → READY_FOR_PICKUP`: owner/receptionist success for diagnosis-backed `UNREPAIRABLE`/`NO_FAULT_FOUND`; technician denial; missing/foreign diagnosis; invalid outcome/source; server `readyAt`.
- Early `CUSTOMER_CANCELLED`: required trimmed note; no-history success; denial after any SENT/ACCEPTED/PARTIALLY_ACCEPTED quote even if later superseded/revoked; denial after payment, REPAIR/TEST work, or part usage; customer-contact/internal-note-only behavior; rollback and concurrency.
- `APPROVED → WAITING_PARTS`: no requirement, all available, required/ordered part, and foreign quote item fixtures.
- `APPROVED/WAITING_PARTS → REPAIRING`: empty approval, missing requirement, unavailable/ordered part, all current scopes available, stale requirement from a prior quote, and active assignment lost between initial read and transaction.
- `REPAIRING → QUALITY_CHECK`: no work, partial item coverage, accepted optional SERVICE/PART coverage, zero-price approved coverage, fee-only behavior, unapproved-item logs, effective/superseded correction history, and complete coverage.
- `QUALITY_CHECK → READY_FOR_PICKUP`: no run, latest fail, older pass plus newer fail, latest pass, invalid outcome, and server timestamp.
- Generic attempts at failed-QC return and completion are rejected.
- Internal transition with valid staged evidence and rollback when event/outbox persistence fails.
- Re-quote draft/send: valid price/display-note-only lineage; changed kind, normalized description, quantity/unit, approval group, and required/optional semantics; new/omitted scope; foreign/duplicate lineage; `QUOTE_SCOPE_LINEAGE_INVALID` audit; identical commercial fingerprint; old approval/history preservation; unapproved-work invariant; concurrency, old/new token behavior, and transaction rollback.
- Public replacement decision: valid lineage persisted in `approvedItemSnapshot`, new scope receives no inherited evidence/readiness, invalid stored lineage rolls back approval/status/event/idempotency and emits only the redacted audit.
- Stale lock, two concurrent transitions, same-key retry, different-payload idempotency conflict, and no duplicate events.
- Captured response/log/event/outbox inspection for raw token, customer contact, private note, and internal cost leakage.

## Definition of Done

- The full Milestone 5 transition graph exists behind one service with explicit direct versus internal-only edges.
- Re-quote send from repair is atomic and preserves immutable prior history.
- Guard logic uses persisted authoritative evidence and has focused unit/integration coverage.
- No RF-040 contract/schema file or out-of-scope module is changed.
- Format, lint, typecheck, unit tests, relevant integration tests, full regression tests, and build pass.

## AI implementation prompt

```text
Bạn đang làm RF-041 — Repair-execution state machine and re-quote trong
C:\RepairFlow.

Đọc theo thứ tự: AGENTS.md, docs/tasks/milestone-5/README.md,
docs/tasks/milestone-5/RF-040-service-contract-persistence.md,
docs/tasks/milestone-5/RF-041-repair-execution-state-machine.md,
docs/tasks/milestone-4/RF-032-state-machine-foundation.md,
docs/tasks/milestone-4/RF-035-quote-draft-api.md,
docs/tasks/milestone-4/RF-036-quote-send-token-outbox.md,
docs/tasks/milestone-4/RF-037-public-quote-read-decision.md,
docs/domain-rules.md, docs/architecture.md, docs/rbac.md,
docs/openapi.yaml, prisma/schema.prisma, docs/error-codes.md,
docs/testing-strategy.md và các implementation hiện tại của state machine,
quote draft, quote send, public decision.

Trước khi code, tóm tắt:
- từng state edge trực tiếp và internal-only thuộc RF-041;
- guard diagnosis-backed UNREPAIRABLE/NO_FAULT_FOUND và early CUSTOMER_CANCELLED;
- role/assignment matrix;
- approved-scope, part-availability, item-level work-coverage và latest-QC guards;
- optimistic lock, idempotency và transaction boundary;
- full-replacement re-quote, exact stable-scope lineage và public-decision reconciliation;
- file ownership và các file dự kiến thay đổi.

Sau đó triển khai DIAGNOSING -> READY_FOR_PICKUP cho UNREPAIRABLE hoặc
NO_FAULT_FOUND khi có diagnosis, và CUSTOMER_CANCELLED chỉ khi có cancellation
note và chưa từng có sent/accepted quote, payment, technical work hoặc part
usage; các lệnh này chỉ OWNER/RECEPTIONIST. Triển khai các edge
APPROVED -> WAITING_PARTS/REPAIRING, WAITING_PARTS -> REPAIRING,
REPAIRING -> QUALITY_CHECK, QUALITY_CHECK -> READY_FOR_PICKUP; cung cấp internal
transition boundary cho QC fail và handover completion.

Mở rộng create/send quote để re-quote từ REPAIRING trong cùng transaction.
Chỉ giữ stable scope lineage khi kind, normalized description, quantity/unit,
approval-group và required/optional semantics không đổi; chỉ price và
non-binding display note được đổi. Invalid lineage trả
QUOTE_SCOPE_LINEAGE_INVALID và ghi audit đã redact, không mutation một phần.
RF-041 cũng phải reconcile lineage đã validate vào approvedItemSnapshot khi
public decision thành công; tuyệt đối không suy lineage từ description/price.

Chỉ state-machine service được sửa status/outcome/timestamps/lockVersion. Lấy
approved scope từ QuoteApproval.approvedItemSnapshot; không tin coverage,
status, outcome, timestamp hoặc ownership từ client. PASS QC vẫn ở
QUALITY_CHECK cho tới lệnh ready riêng. Không cho generic endpoint thực hiện
QC-fail return hoặc COMPLETED. Không triển khai work/part commands, QC record,
payment, handover, warranty, public UI hoặc web UI. Không sửa contract/schema
RF-040 âm thầm; nếu contract thiếu hoặc mâu thuẫn, dừng phần phụ thuộc và báo rõ.

Viết test đầy đủ cho role, active assignment, tenant isolation, early non-repair
và cancellation-history guards, mỗi edge, partial item coverage, part
availability, latest QC, stale lock, concurrency, idempotent retry/mismatch,
mọi lineage field, public-decision reconciliation, audit/rollback và dữ liệu
nhạy cảm. Chạy format, lint, typecheck, test và build.
Không commit hoặc push.
```
