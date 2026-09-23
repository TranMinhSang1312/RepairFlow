# RF-040 — Service execution contract and persistence alignment

## Objective

Freeze the HTTP contract, persistence model, stable errors, and cross-module invariants required by Milestone 5 before any runtime consumer is implemented.

## Scope

- Reconcile `docs/domain-rules.md`, `docs/rbac.md`, `docs/openapi.yaml`, and `prisma/schema.prisma` for repair execution, parts, QC, payments, handover, tracking, and warranty follow-ups.
- Define complete request, response, and read models for every RF-041 through RF-049 operation.
- Extend repair-order detail with approved scope, work logs, part requirements/usage, QC history, payment summary/history, handover, warranty, source order, and follow-up summaries.
- Extend the public order allowlist with customer-safe handover readiness and warranty summary for `TRACK_ORDER` tokens.
- Add the minimum Prisma changes, SQL constraints, indexes, and one forward migration needed by the frozen contract.
- Add stable Milestone 5 error codes and deterministic seed data for at least one active QC template.

## Outside scope

- NestJS controllers, application services, repositories, or frontend code.
- Inventory, purchase orders, refunds, accounting, tax invoices, or online payment.
- Real notification delivery, worker retry behavior, and AI.
- Editing deployed migration history or rewriting existing business records.

## Contract decisions to freeze

### Approved scope and work coverage

- The authoritative approved scope comes exclusively from the latest binding `QuoteApproval.approvedItemSnapshot`; it is never reconstructed from every item in a quote.
- Add a server-owned stable scope lineage for quote items carried into a full-replacement re-quote. A replacement request may reference the prior same-order item, but the server validates ancestry and copies/allocates the stable key; clients cannot invent or reuse another scope key.
- A replacement item may retain lineage only when its kind, normalized description, quantity and quantity unit, approval group, and required/optional classification are unchanged. Price and explicitly contracted non-binding display notes may change. Same-order ancestry alone is insufficient. Reject any invalid carry-forward reference with `QUOTE_SCOPE_LINEAGE_INVALID`, make no quote/status change, and append a redacted audit record. Audit every accepted lineage decision as well.
- Work logs, part requirements, and used-part evidence resolve against stable scope lineage. Carried-forward scope can retain truthful prior evidence, while a new item must collect new evidence.
- `REPAIR` and `TEST` work logs must reference an item in that approved snapshot. `CUSTOMER_CONTACT` and `INTERNAL_NOTE` are unlinked operational notes. A `CORRECTION` resolves and inherits the root log's semantic type and quote-item/scope binding.
- The Milestone 5 no-charge exception is represented by a zero-price quote item accepted by the customer. There is no client-controlled bypass for unapproved work.
- For `REPAIRING -> QUALITY_CHECK`, every approved actionable `SERVICE` or `PART` item must have effective work evidence. `approvalGroup` remains a quote-selection rule and is not reused as a repair-work group.
- Correction history is one linear chain: every record has at most one direct superseder, only the latest descendant is effective, and all earlier records remain immutable. An effective correction rooted in `REPAIR` or `TEST` may satisfy coverage; the `CORRECTION` enum value alone never grants coverage.

### Exact execution command/state matrix

| Command | Allowed order states | Additional rule |
|---|---|---|
| Append `REPAIR` or `TEST` | `REPAIRING` only | Requires current approved actionable scope and active technical authorization. |
| Correct a `REPAIR` or `TEST` log | `REPAIRING` only | Inherits the root semantic type and binding; the target must be the current effective leaf. |
| Append `CUSTOMER_CONTACT` or `INTERNAL_NOTE` | `APPROVED`, `WAITING_PARTS`, `REPAIRING`, `QUALITY_CHECK`, `READY_FOR_PICKUP` | Operational only; never satisfies technical coverage. |
| Correct `CUSTOMER_CONTACT` or `INTERNAL_NOTE` | `APPROVED`, `WAITING_PARTS`, `REPAIRING`, `QUALITY_CHECK`, `READY_FOR_PICKUP` | Inherits the root semantic type; the target must be the current effective leaf. |
| Create/update a part requirement | `APPROVED`, `WAITING_PARTS`, `REPAIRING` | Only for a current approved `PART` lineage. Staff cannot set `CANCELLED`. |
| Append or correct `PartUsed` | `REPAIRING` only | Requires current approved `PART` lineage and cumulative effective quantity within approval. |

No execution write is allowed while the order is `AWAITING_APPROVAL`. No command above is allowed in `RECEIVED`, `DIAGNOSING`, `COMPLETED`, or `VOIDED`. A used-part correction replaces the superseded effective snapshot for cumulative-quantity calculations; it is not added on top of the superseded quantity.

### Parts

- Part availability is separate from immutable `PartUsed` snapshots. Add a tenant-owned `PartRequirement` lifecycle for an approved `PART` quote item.
- Staff may perform only `NEEDED -> ORDERED`, `NEEDED -> AVAILABLE`, and `ORDERED -> AVAILABLE`; `AVAILABLE` is terminal for current scope. `CANCELLED` is terminal and system-only.
- RF-041 replacement-quote acceptance reconciliation marks a requirement `CANCELLED` only when its lineage is omitted from the newly accepted full-replacement scope. Staff APIs and clients cannot request `CANCELLED`. A cancelled requirement cannot belong to current approved scope and neither satisfies nor blocks current-scope guards.
- A used-part snapshot must bind to an approved `PART` item, use positive decimal quantity and non-negative integer-VND prices, and never alter the authoritative approved total.
- A changed scope, quantity, or sale price requires the existing versioned re-quote flow before new work begins.

### Workflow and concurrency

- Add the remaining documented edges: `APPROVED -> WAITING_PARTS|REPAIRING`, `WAITING_PARTS -> REPAIRING`, `REPAIRING -> QUALITY_CHECK`, `QUALITY_CHECK -> REPAIRING|READY_FOR_PICKUP`, and `READY_FOR_PICKUP -> COMPLETED`.
- Complete the earlier non-repaired ready paths: only OWNER or RECEPTIONIST may perform `DIAGNOSING -> READY_FOR_PICKUP` with `UNREPAIRABLE` or `NO_FAULT_FOUND`, and a tenant/order-bound diagnosis must exist. In the MVP, `CUSTOMER_CANCELLED` is also allowed only on `DIAGNOSING -> READY_FOR_PICKUP`, only for OWNER or RECEPTIONIST, with a non-blank cancellation note and only before any quote has reached `SENT`, `ACCEPTED`, or `PARTIALLY_ACCEPTED` and before any payment, technical `REPAIR`/`TEST` work log, or part usage exists.
- Workflow-changing commands carry `expectedLockVersion` and an `Idempotency-Key` where the contract creates binding or retry-sensitive records.
- The central repair-order state-machine service remains the only status writer.
- Re-quoting from `REPAIRING` preserves all prior work history, blocks new execution while `AWAITING_APPROVAL`, and binds later work only to the newly accepted approval snapshot. RF-041 owns runtime lineage reconciliation when the replacement decision becomes binding, including system cancellation of removed part requirements.

### QC

- Add tenant-scoped QC-template list, create-next-version, and deactivate contracts. Published versions and items are immutable; at most one version per `(shop, template name)` is active.
- Add concrete QC-run/result/evidence response schemas, `expectedLockVersion`, idempotency, and ordered history in repair-order detail.
- Every accepted QC submission, including a passing run that leaves status unchanged, atomically increments the repair-order `lockVersion`. Allocate a per-order monotonic `runNo` under the same order lock and use it, rather than timestamp/UUID ordering, to determine the latest authoritative run.
- A submission contains every template item exactly once. `NOT_APPLICABLE` is accepted only when the item permits it. Any `FAIL` makes the run fail and requires a non-blank run-level failure note.
- Failed QC appends the complete run and atomically returns the order to `REPAIRING`. Passed QC leaves it in `QUALITY_CHECK`; a separate authorized transition marks it `READY_FOR_PICKUP` with outcome `REPAIRED`.

### Payments, handover, and warranty

- Add a standalone idempotent payment endpoint because the UI supports multiple payment receipts before or after handover.
- The authoritative figures are `approvedTotal`, `paidTotal`, and `amountDue = max(0, approvedTotal - paidTotal)`. Reject non-positive payments and payments above the remaining balance.
- Before handover, standalone payment is allowed only in `READY_FOR_PICKUP`. After handover, it is allowed only in `COMPLETED` when the immutable handover disposition is `PARTIALLY_PAID` or `PAY_LATER` and authoritative `amountDue` remains positive. It is forbidden in every other state and after `PAID` or `WAIVED` handover.
- A standalone payment requires an accepted binding approval. A valid non-repaired ready order without one has authoritative `approvedTotal = 0`, `paidTotal = 0`, and `amountDue = 0` and cannot accept either standalone or handover-embedded payment; this permits `UNREPAIRABLE`, `NO_FAULT_FOUND`, and eligible `CUSTOMER_CANCELLED` handovers without manufacturing a quote or charge.
- `PAID` requires zero remaining balance. `PARTIALLY_PAID` requires a positive paid total and remaining balance. `WAIVED` and `PAY_LATER` require an explanatory note when a balance remains.
- Handover is allowed only from `READY_FOR_PICKUP`, carries `expectedLockVersion`, and returns the created payment/handover/warranty aggregate.
- A `REPAIRED` handover requires a warranty snapshot. The server sets `startsAt` to `handedOverAt`; the request supplies a later `endsAt` and non-blank terms. Other outcomes cannot create a repair warranty.
- Completing handover revokes every active prior `DECIDE_QUOTE` and `TRACK_ORDER` token for the order and creates one separate `TRACK_ORDER` token. Its server-owned expiry is `max(handedOverAt + 365 days, warranty.endsAt + 30 days)` for repaired orders and `handedOverAt + 365 days` otherwise; reads do not extend it. The handover idempotency record is retained at least until token expiry. Before expiry, same-key/same-payload replay derives the same URL. After expiry, replay returns terminal `TOKEN_EXPIRED` and never mints a replacement token. Return the raw URL only through deterministic in-memory derivation. Raw tokens never enter the database, persisted idempotency response, logs, events, or outbox.
- Handover writes a domain-only transactional outbox event. Milestone 5 does not choose a delivery channel or destination and does not invoke a notification provider; provider delivery and retry begin in Milestone 6.

### Warranty follow-up and public projection

- Add an idempotent `POST /api/v1/repair-orders/{sourceOrderId}/warranty-orders` intake command.
- The source must be tenant-owned, `COMPLETED`, covered by a currently eligible warranty, and explicitly confirmed eligible by an owner or receptionist.
- The new order receives a server code, `serviceType=WARRANTY`, `sourceOrderId`, copied immutable source customer/device snapshots, fresh visit intake evidence/data, and status `RECEIVED`; archived source profiles remain eligible when the source identities belong to the same shop, and the source remains unchanged.
- Public `TRACK_ORDER` output may contain warranty dates, customer-facing terms/status, and safe linked-order progress. It must omit payments, costs, staff identities, signature metadata, customer contacts, internal notes, object keys, and source UUIDs.

## Persistence changes

- Add a same-tenant self relation and direct-superseder uniqueness for `WorkLog.supersedesId`.
- Add `PartRequirement` with stable scope ownership, lifecycle, optimistic versioning, actors, a uniqueness rule for one current requirement per order/scope, and order/status indexes.
- Add the quote-item lineage field/relation and uniqueness needed for full-replacement re-quotes without inferring identity from editable description or price text.
- Add same-tenant quote-item and optional superseding relations to `PartUsed`, plus positive/non-negative SQL checks.
- Persist a canonical normalized QC-template family key and use it for version allocation and a partial unique index allowing one active version per `(shopId, normalizedName)`. Preserve the display name separately. Add a unique `(shopId, qcTemplateId, sortOrder)` constraint so one template cannot contain duplicate item positions.
- Add a per-order monotonic `QcRun.runNo` with a unique `(shopId, repairOrderId, runNo)` constraint and an index supporting latest-run reads.
- Link QC evidence and handover signature media through same-tenant foreign keys; application rules additionally verify order, purpose, completed upload, and expiry.
- Add database checks for positive `Payment.amount` and `Warranty.endsAt > Warranty.startsAt`.
- Keep all existing history and create one new forward migration; do not edit `20260918000100_init` or later deployed migrations.

## API/UI involved

- Staff contracts for state transitions, work logs, part requirements, used parts, QC templates/runs, payments, handover, and warranty intake.
- Expanded `RepairOrderDetailResponse` and `PublicOrderResponse`.
- No UI implementation in this RF.

## Expected files and ownership

- `docs/domain-rules.md`
- `docs/rbac.md` when the frozen capability wording needs clarification
- `docs/screen-specs.md` when a request/response decision changes a documented form rule
- `docs/openapi.yaml`
- `docs/error-codes.md`
- `prisma/schema.prisma`
- `prisma/migrations/<new-milestone-5-migration>/migration.sql`
- `prisma/seed.ts` only for deterministic QC-template fixtures
- Contract/schema validation tests or scripts already used by the repository

RF-040 owns `docs/openapi.yaml` and `prisma/schema.prisma` for this milestone. Later RFs must not silently reshape them; any unavoidable correction updates every affected consumer in the same reviewed change.

## Dependencies

- RF-038 merged.
- No Milestone 5 runtime RF may begin before RF-040 is merged.

## Acceptance criteria

- Every request and response needed by RF-041 through RF-049 is explicit and has stable errors.
- Domain rules, RBAC, OpenAPI, Prisma, and screen requirements no longer contradict one another on approved scope, part readiness, QC, payment, handover, or warranty.
- Tenant ownership is enforceable through composite keys or service-level checks backed by indexed lookups.
- Append-only and one-active/one-terminal constraints have database support where practical.
- The contract contains one explicit command/state matrix, system-only part cancellation, linear correction semantics, and exact stable-lineage carry-forward validation.
- Non-repaired ready transitions and customer cancellation have explicit actors, evidence guards, notes, and zero-total handover behavior.
- QC latest-run selection uses monotonic `runNo`, and every accepted submission advances `lockVersion` even when status stays `QUALITY_CHECK`.
- Payment state eligibility and TRACK-token expiry/replay/revocation/outbox behavior are fully specified without depending on a notification provider.
- Warranty follow-up permits same-shop archived source identities, copies immutable source snapshots, and writes its relationship/event only through the new child order without changing source-owned history.
- A clean database and an upgraded Milestone 4 database both accept the forward migration without losing history.
- OpenAPI validation, Prisma format/validate, migration deployment, seed, and migration status succeed.

## Required tests and checks

- OpenAPI parse/compatibility validation.
- `prisma format` and `prisma validate`.
- Clean migration deployment, upgrade deployment, deterministic seed, and migration status.
- Database constraint probes for tenant FKs, one active normalized QC family version, unique template item order, unique QC run number, positive payment, warranty dates, and superseding relations.
- Contract probes for every work/part command-state pair, correction-chain effectiveness, system-only cancellation, valid/invalid scope lineage, non-repaired/cancelled ready transitions, payment-state eligibility, QC lock advancement/latest-run ordering, and TRACK replay before/after expiry.
- Warranty contract probes for active/archived source identities, exact source-snapshot copying, and absence of source-row/source-event writes.
- Search proving no raw token, secret, or customer data was added to fixtures or migration SQL.

## Definition of Done

- Contract and migration are reviewable without runtime implementation.
- Every unresolved choice is decided in the source-of-truth documents rather than left to later coding agents.
- Existing Milestone 4 tests remain green.
- Format and all applicable schema/contract checks pass.

## AI implementation prompt

```text
Bạn đang làm RF-040 — Service execution contract and persistence alignment trong
C:\RepairFlow. Đọc AGENTS.md, docs/tasks/milestone-5/README.md,
docs/tasks/milestone-5/RF-040-service-contract-persistence.md,
docs/implementation-plan.md, docs/product-spec.md, docs/domain-rules.md,
docs/architecture.md, docs/rbac.md, docs/screen-specs.md, docs/openapi.yaml,
prisma/schema.prisma, docs/error-codes.md và docs/testing-strategy.md.

Trước khi sửa, hãy lập bảng gap giữa domain, OpenAPI và Prisma cho approved
scope, work logs, part availability/usage, QC, payment, handover, tracking token
và warranty follow-up. Chốt rõ command/state matrix; correction chain và
effective quantity; system-only part cancellation; quy tắc giữ stable lineage;
DIAGNOSING -> READY_FOR_PICKUP cho unreparable/no-fault/customer-cancelled;
payment states và zero-total non-repaired handover; QC runNo + lockVersion;
normalized template family; TRACK expiry/replay/revoke và domain-only outbox.
Chốt thêm warranty follow-up cho archived source identity, copy immutable source
snapshots và chỉ ghi child relation/event trên order mới, không ghi source.
Sau đó đóng băng toàn bộ contract RF-041 đến RF-049, cập nhật source-of-truth,
tạo đúng một forward migration và seed QC deterministic.

Không triển khai controller/service/UI, không sửa migration đã deploy và không
thêm inventory/accounting/real notification/AI. Chạy OpenAPI validation, Prisma
format/validate, deploy migration trên database sạch và database nâng cấp, seed,
migration status cùng các kiểm tra định dạng phù hợp. Không commit hoặc push.
Cuối cùng báo quyết định contract, file thay đổi, kết quả migration và giới hạn.
```
