# Milestone 5 — Repair execution, QC, handover, and warranty

## Business outcome

RepairFlow advances an approved repair through controlled execution and the end of physical custody:

1. Owner or the assigned technician resolves required-part availability and starts only customer-approved work.
2. Work logs and actual parts-used snapshots preserve what was done, by whom, and against which approved quote item.
3. A diagnosed device that is unrepairable, has no fault, or is cancelled before any commercial/technical execution can move to pickup through an explicit guarded outcome.
4. Changed scope or price pauses execution and returns the order to a new quote decision without rewriting earlier approval or work history.
5. Repair work enters quality control only after every approved actionable service/part item has item-level work evidence.
6. QC records the exact template version and immutable item results. A failed run returns the order to repair; a passing run enables a separate ready-for-pickup transition.
7. Owner or receptionist records idempotent payments and completes physical handover atomically with a warranty snapshot when the outcome is repaired.
8. A warranty return creates a new linked intake while the completed source order remains unchanged.
9. A separate tracking link exposes only customer-safe completion and warranty information.

The milestone completes the MVP's controlled custody journey. It does not add inventory accounting, online payments, a real notification provider, or AI decision-making.

## Numbering note

This folder uses RF-040 through RF-049 reserved by `docs/implementation-plan.md` for repair, QC, handover, and warranty. RF-040 freezes the shared contract and persistence decisions before implementation RFs may consume them.

## Scope

- Missing Milestone 5 API contracts, response mappings, error codes, persistence relations, indexes, migration, and seed alignment.
- Remaining repair-order state-machine edges and guards.
- Guarded non-repair/cancellation exits from diagnosis.
- Approved-scope work logs, append-only corrections, part requirements, availability, and parts-used snapshots.
- Waiting-parts and full-replacement re-quote behavior.
- Versioned, immutable QC templates and append-only QC runs/results.
- Server-derived QC result and QC-gated ready-for-pickup behavior.
- Idempotent operational payment records.
- Atomic handover, status completion, warranty snapshot, token lifecycle, timeline, and outbox records.
- Linked warranty intake that leaves the source order unchanged.
- Staff Work, QC, Handover, and Warranty UI plus customer-safe completion/warranty portal mapping.
- Mobile behavior at a 360px viewport and meaningful loading, empty, error, conflict, retry, and read-only states.

## Outside scope

- Inventory counts, stock reservations, purchase orders, suppliers, receiving, or automatic stock decrement.
- Accounting ledger, tax invoice, refunds, chargebacks, reconciliation, or online payment gateway.
- Editing/deleting sent quotes, approvals, effective work history, QC history, handovers, payments, warranties, or completed orders.
- Reopening `COMPLETED`; warranty service always creates a new repair order.
- Real email, SMS, or Zalo delivery and worker retry/dead-letter operations; those belong to Milestone 6.
- Device unlock credential storage.
- AI diagnosis, QC pass/fail, price, warranty eligibility, or any other binding AI decision.
- Technician self-assignment, receptionist technical execution, or failed-QC override.

## Frozen design decisions owned by RF-040

RF-040 updates `docs/openapi.yaml`, `docs/error-codes.md`, `prisma/schema.prisma`, the migration, and any affected source-of-truth wording before later RFs implement consumers. Later RFs must not silently reshape these contracts.

### Approved scope and execution

- The authoritative approved scope comes from `QuoteApproval.approvedItemSnapshot`, never from current quote rows or client input.
- A later accepted quote version is a full replacement commercial scope. Its approval snapshot and `approvedTotal` become authoritative while all earlier quote, decision, work, and part history remains immutable.
- Quote items may keep stable server-owned scope lineage only when kind, normalized description, quantity/unit, approval-group membership, and required-versus-optional semantics are unchanged. The client may identify the prior item, but the server validates same-shop/order ancestry and owns the stable scope key.
- Only price and a non-binding display note may change while preserving lineage. Any other semantic change is new scope and receives a new key; omitted scope stops being current.
- Work and part evidence follows only validated stable lineage, so a price-only re-quote does not require fabricated duplicate work while genuinely new scope cannot inherit evidence. Invalid, foreign, duplicate, or semantically changed lineage is rejected with `QUOTE_SCOPE_LINEAGE_INVALID` and a redacted audit record.
- RF-041 owns runtime lineage validation during re-quote and reconciliation into the next public decision/approval snapshot; no later API may infer lineage from description alone.
- No-charge work is permitted only when represented by an approved quote item whose authoritative unit price is zero. A free-text flag or client assertion cannot authorize extra work.
- Work coverage is item-level: every actionable quote item of kind `SERVICE` or `PART` in the authoritative approved snapshot, including an accepted optional item and a zero-price item, requires effective linked `REPAIR`/`TEST` evidence through the same stable scope lineage before `REPAIRING → QUALITY_CHECK`. A `FEE` item never requires work evidence.
- `REPAIR` and `TEST` logs must link to an approved quote item according to the frozen contract. Corrections append a new log, inherit the binding of the superseded record, and become the effective evidence; a directly superseded record no longer satisfies coverage.

### Parts

- `PartRequirement` is separate from `PartUsed`. It tracks only case-level readiness for an accepted quote item and is not inventory.
- Each accepted `PART` scope has one tenant/order/scope-bound requirement. Missing requirement data counts as not ready. The lifecycle is `NEEDED → ORDERED → AVAILABLE`, with `CANCELLED` preserved for scope removed through the contracted re-quote path; an item already on hand may move directly from `NEEDED` to `AVAILABLE`.
- `PartUsed` is an immutable snapshot of the actual name, SKU, quantity, unit cost, and unit sale price. It must link to an approved item and never changes payment totals.
- Starting repair is blocked while any accepted part requirement is not `AVAILABLE`. `WAITING_PARTS` requires at least one non-available accepted requirement.

### QC

- QC template versions and their items are immutable once published or referenced. A change creates a new version.
- A QC submission records the selected template version and every item result. The server derives the run result.
- `PASS` remains in `QUALITY_CHECK`; it only enables a separate `QUALITY_CHECK → READY_FOR_PICKUP` transition with outcome `REPAIRED`.
- `FAIL` and its failure notes are committed atomically with `QUALITY_CHECK → REPAIRING`.
- The latest QC run is authoritative. A later failure prevents an older pass from satisfying the ready guard.

### Money, handover, warranty, and tokens

- Money is integer VND. The latest binding approval's `approvedTotal` is authoritative.
- A non-repaired handover with no binding approval has `approvedTotal = 0`, `paidTotal = 0`, and `amountDue = 0`; it forbids both standalone and embedded payment. This exception supports `UNREPAIRABLE`, `NO_FAULT_FOUND`, and a valid early `CUSTOMER_CANCELLED` outcome without manufacturing a commercial total.
- `amountDue = max(0, approvedTotal - sum(successfully recorded payments))`. Actual parts-used prices do not alter it.
- Payment amount must be positive and cannot exceed the current amount due. Overpayment is rejected.
- Standalone payment is allowed only while the order is `READY_FOR_PICKUP`, or after handover while it is `COMPLETED` with immutable disposition `PARTIALLY_PAID`/`PAY_LATER` and positive amount due. Payment during diagnosis, approval, waiting-parts, repair, re-quote, or QC is forbidden.
- Payment creation and handover are idempotent. Same key/same payload returns the original result; same key/different payload returns `IDEMPOTENCY_KEY_REUSED`. A completed pay-later/partial case may receive later append-only payments without reopening or rewriting its handover.
- `COMPLETED` means physical custody ended. Only the handover transaction may perform `READY_FOR_PICKUP → COMPLETED`.
- A repaired handover requires a warranty snapshot. `startsAt` is the server handover timestamp; `endsAt` must be later and terms must be non-empty. Non-repaired outcomes cannot create a warranty.
- Completing handover revokes every active `DECIDE_QUOTE` and older `TRACK_ORDER` token, then creates exactly one distinct `TRACK_ORDER` token whose server-owned expiry is `max(handedOverAt + 365 days, warranty.endsAt + 30 days)` when a warranty exists, or `handedOverAt + 365 days` otherwise. Usage never extends it automatically.
- The handover idempotency record remains valid at least until the created TRACK token expires. Same-key replay before expiry derives the same URL; replay after expiry returns terminal `TOKEN_EXPIRED` and never mints a replacement token.
- Raw token/public URL is returned only through the derivation boundary and is never stored or logged. The handover outbox contains a domain-only completion event with no destination, provider request, delivery record, token, or URL.
- Public tracking exposes only customer-safe order status, completion outcome, public timeline, and warranty summary. It never exposes payment records, internal costs, private notes, staff identity, object keys, audit payloads, or source database IDs.

## Dependency order

```text
RF-040 Contract and persistence alignment
    ├── RF-041 Repair-execution state-machine and re-quote
    │       └── RF-042 Approved-scope work and parts API
    │               └── RF-043 Web Work workspace
    └── RF-044 Versioned QC templates API

RF-041 + RF-042 + RF-044
    └── RF-045 QC runs and readiness API

RF-043 + RF-045
    └── RF-046 Web QC

RF-041 + RF-042 + RF-045
    └── RF-047 Payment, atomic handover, warranty snapshot, and TRACK token
            └── RF-048 Linked warranty follow-up API and public mapping

RF-043 + RF-046 + RF-047 + RF-048
    └── RF-049 Web handover, warranty follow-up, and public completion
```

RF-041 and RF-044 may begin after RF-040 and may run in parallel only with separate file ownership. RF-042 depends on the transition/guard contract in RF-041. RF-045 depends on RF-041 for QC edges, RF-042 for effective work evidence, and RF-044 for immutable templates. RF-046 follows both staff-workspace integration in RF-043 and the complete QC API in RF-045. RF-047 and RF-048 are transaction-heavy and must merge in dependency order; RF-049 begins only after its four backend and workspace dependencies are merged.

## Role and state matrix

`O` means an active assignment to the same tenant-owned order is required.

| Capability | Owner | Receptionist | Technician | Required state/condition |
|---|:---:|:---:|:---:|---|
| View execution/QC/payment/handover history | A | A | O | Same shop; technician active assignment |
| Start approved repair | A | — | O | `APPROVED`; approved scope; all required parts available |
| Mark/request waiting parts | A | — | O | `APPROVED`; at least one accepted part not available |
| Update part requirement / add work / record part used | A | — | O | Valid execution state and approved item |
| Send a replacement quote | A | A | — | `REPAIRING`; changed full-replacement scope/price |
| Mark unrepairable/no fault | A | A | — | `DIAGNOSING`; a diagnosis exists |
| Cancel before execution | A | A | — | `DIAGNOSING`; cancellation note; no sent/accepted quote, payment, technical work, or part usage |
| Enter quality check | A | — | O | `REPAIRING`; item-level work coverage complete |
| Manage QC templates | A | — | — | Shop-scoped versioned configuration |
| Submit QC run | A | — | O | `QUALITY_CHECK` |
| Mark ready after passing QC | A | A | O | `QUALITY_CHECK`; latest QC `PASS`; outcome `REPAIRED` |
| Record payment | A | A | — | `READY_FOR_PICKUP`, or `COMPLETED` after partial/pay-later handover with positive due |
| Complete handover | A | A | — | `READY_FOR_PICKUP`; disposition and evidence valid |
| Create warranty follow-up | A | A | — | Completed source with eligible warranty |

State edges owned or completed by this milestone:

| From | To | Trigger and authoritative guard |
|---|---|---|
| `DIAGNOSING` | `READY_FOR_PICKUP` | Owner/receptionist; diagnosis exists; outcome `UNREPAIRABLE` or `NO_FAULT_FOUND` |
| `DIAGNOSING` | `READY_FOR_PICKUP` | Owner/receptionist; outcome `CUSTOMER_CANCELLED`; non-blank cancellation note; no sent/accepted quote, payment, technical work, or part usage |
| `APPROVED` | `WAITING_PARTS` | Staff transition; at least one accepted requirement is not `AVAILABLE` |
| `APPROVED` | `REPAIRING` | Staff transition; active technician, approved scope, every accepted PART scope has one `AVAILABLE` requirement |
| `WAITING_PARTS` | `REPAIRING` | Staff transition; all accepted requirements available |
| `REPAIRING` | `AWAITING_APPROVAL` | Replacement quote send transaction; changed full scope/price; no unapproved work |
| `REPAIRING` | `QUALITY_CHECK` | Staff transition; every approved actionable `SERVICE`/`PART` item has effective work evidence |
| `QUALITY_CHECK` | `REPAIRING` | Failed QC transaction with failure notes |
| `QUALITY_CHECK` | `READY_FOR_PICKUP` | Separate staff transition; latest QC passes; outcome `REPAIRED` |
| `READY_FOR_PICKUP` | `COMPLETED` | Handover transaction only |

No generic endpoint may bypass the central state-machine service, and callers that also create binding records must participate in the same database transaction.

## Shared invariants

- Every staff request validates bearer identity, active `X-Shop-Id` membership, capability, tenant ownership, and assignment where required.
- A foreign-tenant resource behaves as not found. Repository queries include `shopId` and relation checks reject cross-order child IDs.
- Permission sets must be explicit. Adding a technician-only capability must not accidentally grant it to receptionist through a shared “all capabilities” set.
- The central state-machine service is the sole writer of repair-order status, outcome, ready/returned timestamps, and lock version.
- Status-changing commands use optimistic locking and re-read guard data in the transaction.
- Stable scope lineage is server-validated and audited; invalid lineage cannot alter quote, approval, status, work coverage, or part readiness.
- Work logs, corrections, part snapshots, QC runs/results, payments, handovers, warranties, timeline events, and completed source orders preserve history.
- Server code derives approved scope, work coverage, QC result, amount due, payment disposition validity, status, warranty start, token scope, and all timestamps.
- Transactional commands commit their business record, status/event/outbox effects, and idempotency result together or roll back completely.
- Raw public tokens, access/refresh tokens, customer contact details, internal costs, and private notes never enter logs, public payloads, events, outbox payloads, or persisted idempotency response bodies.
- Media is private. Every QC/handover/signature asset is checked for tenant/order ownership, purpose, MIME, size, completed upload, and expiry before binding.
- Handover emits a domain-only outbox event. Milestone 5 does not create a destination/provider delivery request for that event.

## File-ownership coordination

| RF | Primary owned files/modules | Shared-file rule |
|---|---|---|
| RF-040 | `docs/openapi.yaml`, `docs/error-codes.md`, `docs/domain-rules.md` when needed, `prisma/schema.prisma`, one Milestone 5 migration | Exclusive contract/schema ownership until merged |
| RF-041 | `apps/api/src/modules/repair-orders/state-machine/*`, re-quote changes in `apps/api/src/modules/quotes/*`, transition tests | Must merge before another RF edits state-machine files |
| RF-042 | `apps/api/src/modules/service-execution/*`, execution detail mapper/tests | Must not alter RF-040 public contract silently |
| RF-043 | `apps/web/src/components/repair-orders/work-panel*`, corresponding web API client/types/tests | One integrator owns workspace/CSS edits |
| RF-044 | `apps/api/src/modules/quality-control/templates/*`, QC template seed/tests | Does not edit state-machine files |
| RF-045 | `apps/api/src/modules/quality-control/runs/*`, readiness guard integration, QC detail mapping/tests | Begins after RF-041; sole state-machine owner during its branch |
| RF-046 | `apps/web/src/components/repair-orders/qc-panel*`, QC settings/client/tests | One integrator owns workspace/CSS edits |
| RF-047 | `apps/api/src/modules/payments/*`, `apps/api/src/modules/handovers/*`, public-token/state-machine integration/tests | Sole owner of handover transaction and completion edge |
| RF-048 | `apps/api/src/modules/warranties/*`, public safe warranty mapping/tests | Does not reshape payment/handover contract |
| RF-049 | Handover/warranty/public completion web components, clients, tests, workspace/public portal integration | One integrator owns shared web files |

`apps/api/src/app.module.ts`, repair-order detail types/repository, `apps/api/src/common/permissions/capability.ts`, `apps/web/src/components/repair-orders/repair-order-workspace.tsx`, `apps/web/src/lib/api/types.ts`, and `apps/web/src/app/globals.css` are hotspots. Only the active dependency RF edits a hotspot; parallel branches must nominate one integrator instead of independently resolving conflicts.

## Milestone acceptance criteria

- Owner or assigned technician can execute only the latest approved item scope and cannot start while an accepted required part is unavailable.
- Owner/receptionist can mark a diagnosed device `UNREPAIRABLE`/`NO_FAULT_FOUND`; early `CUSTOMER_CANCELLED` is possible only before any sent/accepted quote, payment, technical work, or part usage and requires a cancellation note.
- Changed scope/price requires a new immutable quote decision before that work can begin.
- Carried scope retains evidence only under exact stable-lineage rules; invalid lineage returns `QUOTE_SCOPE_LINEAGE_INVALID` and creates a redacted audit record.
- Work and actual-part history is append-only and cross-tenant safe.
- Repair cannot enter QC until every approved actionable `SERVICE`/`PART` item has item-level effective work evidence.
- QC uses an immutable template version; incomplete/invalid results are rejected; a failed run atomically returns to repair.
- A repaired order cannot become ready without the latest passing QC run.
- Payments are positive, idempotent, tenant-scoped, bounded by server amount due, and accepted only at pickup or after a partial/pay-later handover; a non-repaired order without binding approval remains zero/zero/zero and cannot receive payment.
- Only one concurrent handover succeeds. Completion atomically records handover, optional final payment, warranty snapshot, status/timestamps, token changes, timeline/outbox, and idempotency.
- A completed order has physical handover evidence and cannot be reopened.
- A warranty return creates a new `WARRANTY` order while every persisted field and history record of the source order remains unchanged; `warranty_case.opened` is appended only to the new order and never to the completed source.
- Handover revokes prior decision/tracking tokens, creates one TRACK token, retains idempotency through token expiry, replays the same URL only before expiry, and returns terminal `TOKEN_EXPIRED` afterward without minting a token.
- Public completion/warranty responses contain no payment, private note, internal cost, staff identity, object key, or raw token.
- Work, QC, handover, warranty, and public completion flows function at 360px with useful loading, empty, rejected, retry, stale, and terminal states.
- Format, lint, typecheck, unit/integration tests, build, migration deployment, migration status, and full cross-tenant regression all pass.

## Branch and PR order

Use one branch and PR per RF:

1. `feat/RF-040-service-contract-alignment`
2. `feat/RF-041-repair-execution-state-machine`
3. `feat/RF-042-work-parts-api`
4. `feat/RF-043-web-work-execution`
5. `feat/RF-044-qc-templates-api`
6. `feat/RF-045-qc-runs-readiness`
7. `feat/RF-046-web-qc`
8. `feat/RF-047-payment-handover-api`
9. `feat/RF-048-warranty-follow-up-api`
10. `feat/RF-049-web-handover-warranty`

Do not combine schema/OpenAPI changes from later RFs without explicitly returning ownership to RF-040 and updating all affected consumers in the same reviewed change.
