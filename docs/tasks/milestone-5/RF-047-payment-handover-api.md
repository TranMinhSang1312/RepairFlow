# RF-047 — Idempotent payment and atomic handover API

## Objective

Record bounded operational payments before or after handover and end physical custody through one idempotent transaction that creates immutable handover evidence, a repaired-outcome warranty snapshot, a safe tracking-token boundary, timeline/outbox records, and the terminal `COMPLETED` state.

## Scope

- Implement standalone idempotent payment creation only at pickup or for an eligible remaining balance after handover.
- Expose payment history and server-derived `approvedTotal`, `paidTotal`, and `amountDue` in the staff repair-order detail contract frozen by RF-040.
- Implement/complete `POST /api/v1/repair-orders/{repairOrderId}/handovers` with `Idempotency-Key` and optimistic concurrency.
- Validate optional signature/handover media through the private media ownership/upload boundary.
- Optionally create a final payment inside the handover transaction.
- Validate payment disposition against authoritative totals after any embedded payment.
- Create one immutable handover record.
- For outcome `REPAIRED`, create one immutable warranty snapshot whose `startsAt` is the server handover timestamp.
- Revoke every active `DECIDE_QUOTE` and prior `TRACK_ORDER` token, then create exactly one distinct expiring `TRACK_ORDER` token without persisting raw token material.
- Transition `READY_FOR_PICKUP → COMPLETED` through the RF-041 internal state-machine API in the same transaction.
- Append customer-safe/private timeline payloads and a domain-only outbox event with no delivery destination/provider request.
- Return the completed staff representation and one-time/idempotently derivable public tracking URL according to RF-040.

## Outside scope

- Online payment collection, gateway/webhooks, invoices, tax, refunds, chargebacks, reconciliation, or accounting ledger behavior.
- Editing/deleting/cancelling a payment, handover, or warranty after commit.
- Creating a warranty follow-up repair order; RF-048 owns that operation.
- Public warranty response mapping and staff/public UI; RF-048/RF-049 own those consumers.
- Real email/SMS/Zalo delivery and worker retries.
- Changing QC result, bypassing ready state, reopening `COMPLETED`, or accepting a client-selected status/timestamp/token scope.

## Flow and transaction boundaries

### Standalone payment creation

1. Require bearer authentication, active selected-shop membership, OWNER/RECEPTIONIST capability, `Idempotency-Key`, and a valid request body.
2. Resolve the tenant-scoped idempotency key and canonical request hash.
3. Lock/read the tenant-owned order and latest binding approval. Require either `READY_FOR_PICKUP`, or `COMPLETED` with an immutable handover disposition of `PARTIALLY_PAID`/`PAY_LATER` and positive remaining due. Reject payment in every diagnosis, quote, waiting-parts, repair, re-quote, and QC state.
4. Reject an order with no binding approval. Otherwise derive `approvedTotal`, sum existing payments, and calculate `amountDue` on the server.
5. Require positive integer-VND amount not exceeding current `amountDue`; validate method/reference.
6. Insert the immutable payment with server actor/time.
7. Append the payment timeline/audit event using a public-safe payload and persist the idempotent response.
8. Commit atomically and return authoritative updated totals.

Same key and payload returns the original payment/totals. The same key with another payload returns `IDEMPOTENCY_KEY_REUSED`. Concurrent payment attempts re-read/lock totals so their combined amount cannot exceed the amount due.

### Atomic handover

1. Require authentication, active tenant membership, OWNER/RECEPTIONIST capability, `Idempotency-Key`, and `expectedLockVersion` from RF-040's contract.
2. Resolve the idempotency record/request hash, lock the tenant-owned order, compare lock version, and re-read all guards.
3. Require `READY_FOR_PICKUP`, a valid `completionOutcome`, no existing handover, and no terminal state.
4. Derive the latest accepted binding `approvedTotal`, current `paidTotal`, and `amountDue`. For a valid non-repaired outcome with no binding approval, require no historical payment and set all three figures to zero; forbid both standalone and embedded payment rather than manufacturing a commercial total. Otherwise validate any embedded payment without trusting client totals.
5. Validate recipient name, payment disposition/conditional note, and optional uploaded signature/handover media belonging to the same shop/order with an allowed purpose.
6. Set one server `handedOverAt` timestamp. For `REPAIRED`, validate non-empty warranty terms and an end after this timestamp, then create the warranty with `startsAt = handedOverAt`. Reject warranty input for all other outcomes.
7. Insert the optional payment, immutable handover, and warranty in the transaction.
8. Revoke every active `DECIDE_QUOTE` and existing `TRACK_ORDER` token for the order. Create exactly one new `TRACK_ORDER` record with expiry `max(handedOverAt + 365 days, warranty.endsAt + 30 days)` when repaired or `handedOverAt + 365 days` otherwise; derive the raw token through the keyed deterministic boundary used for idempotent public URLs and persist only its hash/metadata. Reads never extend expiry.
9. Call the RF-041 internal transition to `COMPLETED`, setting `returnedAt = handedOverAt` and incrementing `lockVersion`.
10. Append `repair_order.completed`/handover/warranty timeline and one domain-only outbox record with no destination, provider request/delivery, raw URL/token, or private payment data.
11. Persist only a sanitized idempotent response representation and retain the handover idempotency record at least through the TRACK token expiry; commit, then construct the public tracking URL in memory.
12. A same-key/same-payload replay before token expiry derives the same usable URL. A replay after token expiry returns terminal `TOKEN_EXPIRED` and must not create, rotate, or extend any token.

Any error at payment, media, handover, warranty, token, transition, event, domain outbox, or idempotency persistence rolls back the entire handover. RF-047 does not call a provider or create a notification delivery.

## Business, authorization, and security rules

- Only OWNER or RECEPTIONIST may record payment or complete handover. TECHNICIAN is denied even when assigned.
- Every read/write includes `shopId`. Cross-tenant order, quote approval, media, token, or child reference behaves as not found.
- The latest binding `QuoteApproval.approvedTotal` is authoritative. A later accepted replacement quote is the full replacement commercial total.
- A valid non-repaired order may have no binding approval. Its handover summary is exactly `approvedTotal = 0`, `paidTotal = 0`, and `amountDue = 0`; it forbids standalone/embedded payment and fails the guard if contradictory payment history exists.
- `amountDue = max(0, approvedTotal - sum(payments))`; payment amount is a positive integer VND and overpayment is rejected.
- Part-used `unitCost`/`unitSalePrice`, draft/sent quote totals, client totals, and public data never affect payment due.
- Before handover, standalone payment is allowed only in `READY_FOR_PICKUP` with a binding approval and positive amount due. It is forbidden in `APPROVED`, `WAITING_PARTS`, `REPAIRING`, `AWAITING_APPROVAL`, `QUALITY_CHECK`, diagnosis, and every earlier state.
- After handover, standalone payment is allowed only in `COMPLETED` when the immutable disposition is `PARTIALLY_PAID` or `PAY_LATER` and authoritative amount due remains positive. A later receipt never reopens the order or rewrites the handover/disposition.
- Payment rows are append-only operational receipts, not ledger entries. Corrections/refunds are outside scope.
- After optional final payment, disposition must satisfy:
  - `PAID`: final `amountDue` is zero;
  - `PARTIALLY_PAID`: final `amountDue` is positive, cumulative paid amount is positive, and a note is present;
  - `PAY_LATER`: final `amountDue` is positive and a note is present;
  - `WAIVED`: final `amountDue` is positive and a reason note is present.
- A zero-total/no-balance order uses `PAID`; client cannot label an existing balance paid without payment evidence.
- Handover requires recipient, staff actor, server timestamp, payment disposition, and valid current completion outcome. Signature/photo is optional but, if present, must pass media verification.
- Outcome `REPAIRED` requires a latest passing QC indirectly through the prior ready transition and requires warranty in this transaction. The API re-checks ready state and must not manufacture/bypass QC evidence.
- Warranty `startsAt` is exactly server `handedOverAt`; client cannot provide it. `endsAt` must be later and terms are snapshotted, non-empty, and immutable.
- Non-repaired outcomes (`DECLINED_QUOTE`, `UNREPAIRABLE`, `NO_FAULT_FOUND`, `CUSTOMER_CANCELLED`) reject warranty input.
- Exactly one handover and warranty may exist for an order. Concurrent handovers cannot both win.
- Handover is the only route to `COMPLETED`. A completed order cannot be reopened or handed over again; only a bounded append-only later payment is permitted when an earlier partial/pay-later disposition left positive amount due.
- All active `DECIDE_QUOTE` tokens and every older `TRACK_ORDER` token for the order are revoked at handover. Exactly one new TRACK token is created; it cannot decide a quote or access another order.
- Handover idempotency retention is at least the TRACK expiry. Same-key/same-payload replay before expiry returns the same derived URL; replay after expiry returns terminal `TOKEN_EXPIRED` and never mints or extends a token.
- The handover outbox record is a domain-only event. It contains no destination and causes no provider or notification-delivery call in RF-047.
- Raw tracking token/public URL is never stored in PostgreSQL, idempotency response JSON, event/outbox/audit payload, or logs. Captured exceptions also redact it.
- Public/timeline payloads omit payment amounts/method/reference, internal cost, private notes, staff identity/contact, warranty eligibility notes, object keys, and database IDs not explicitly public-safe.

## API/UI involved

- `POST /api/v1/repair-orders/{repairOrderId}/payments`
  - bearer auth, `X-Shop-Id`, and `Idempotency-Key`;
  - accepts amount, method, optional reference according to RF-040;
  - returns the immutable payment and authoritative payment summary;
  - accepts only `READY_FOR_PICKUP`, or eligible `COMPLETED` partial/pay-later balance.
- `POST /api/v1/repair-orders/{repairOrderId}/handovers`
  - bearer auth, `X-Shop-Id`, `Idempotency-Key`, and `expectedLockVersion`;
  - accepts recipient, disposition/note, optional signature asset, optional final payment, and repaired-only warranty end/terms;
  - rejects client `status`, `returnedAt`, `handedOverAt`, warranty `startsAt`, totals, token, token scope, actor, or shop ownership;
  - returns completed staff order/handover/payment/warranty summary and the one-time/idempotently derivable `trackingUrl` contracted by RF-040;
  - returns terminal `TOKEN_EXPIRED` for same-key replay after the created TRACK token expires.
- Existing `GET /api/v1/repair-orders/{repairOrderId}` gains only RF-040's frozen staff payment/handover/warranty summary mapping.
- Internal RF-041 state-machine and public-token services.
- No UI changes in this RF.

## Expected files and ownership

RF-047 owns the following implementation areas:

- `apps/api/src/modules/payments/payment.dto.ts`
- `apps/api/src/modules/payments/payment.types.ts`
- `apps/api/src/modules/payments/payments.repository.ts`
- `apps/api/src/modules/payments/payments.service.ts`
- `apps/api/src/modules/payments/payments.controller.ts`
- `apps/api/src/modules/payments/payments.module.ts`
- `apps/api/src/modules/handovers/handover.dto.ts`
- `apps/api/src/modules/handovers/handover.types.ts`
- `apps/api/src/modules/handovers/handovers.repository.ts`
- `apps/api/src/modules/handovers/handovers.service.ts`
- `apps/api/src/modules/handovers/handovers.controller.ts`
- `apps/api/src/modules/handovers/handovers.module.ts`
- `apps/api/src/modules/public-access/public-token.service.ts` and focused repository/types needed for revoke/create/derive TRACK behavior
- `apps/api/src/common/idempotency/idempotency.service.ts` and focused types/tests needed to retain handover replay metadata through TRACK expiry
- `apps/api/src/modules/repair-orders/state-machine/*` only for RF-041's completion integration, without changing public graph semantics
- `apps/api/src/modules/repair-orders/repair-order.types.ts`
- `apps/api/src/modules/repair-orders/repair-orders.repository.ts` and service mapper for the frozen staff detail fields
- `apps/api/src/common/permissions/capability.ts`
- `apps/api/src/app.module.ts` and relevant module imports
- `apps/api/test/payments.e2e.test.ts`
- `apps/api/test/handovers.e2e.test.ts`
- Focused unit tests beside payment calculation/token derivation code where appropriate

RF-047 must not edit `prisma/schema.prisma`, migrations, `docs/openapi.yaml`, or RF-048 warranty-follow-up/public mapping files. RF-040 owns schema/contracts; RF-048 owns follow-up creation and public warranty mapping. While RF-047 is active, it is the sole owner of handover transaction, completion-edge integration, and public-token lifecycle files.

## Dependencies

- `docs/tasks/milestone-5/RF-040-service-contract-persistence.md` implementation merged.
- `docs/tasks/milestone-5/RF-041-repair-execution-state-machine.md` implementation merged.
- `docs/tasks/milestone-5/RF-042-work-logs-parts-api.md` implementation merged.
- `docs/tasks/milestone-5/RF-045-qc-run-workflow-api.md` implementation merged, so a repaired order can legitimately reach `READY_FOR_PICKUP`.
- `docs/tasks/milestone-4/RF-032-state-machine-foundation.md`, `docs/tasks/milestone-4/RF-036-quote-send-token-outbox.md`, and `docs/tasks/milestone-4/RF-037-public-quote-read-decision.md` remain authoritative for state transition, token derivation/outbox, and public-token safety behavior.
- RF-048 and RF-049 depend on this RF's immutable payment/handover/warranty/TRACK result.

## Acceptance criteria

- OWNER/RECEPTIONIST can create a positive payment within authoritative amount due; TECHNICIAN and foreign-tenant actors cannot.
- Pre-handover payment succeeds only in `READY_FOR_PICKUP`; diagnosis, quote, waiting-parts, repair/re-quote, and QC states reject it. Post-handover payment succeeds only for `COMPLETED` partial/pay-later cases with positive due.
- A non-repaired handover without binding approval returns zero approved/paid/due totals and cannot contain or follow any payment.
- Payment create is atomic and idempotent; concurrent payments cannot overpay.
- Staff detail returns integer-VND approved/paid/due totals derived by the server and immutable payment history.
- A valid ready repaired order completes in one transaction with optional final payment, handover, warranty, token changes, status/timestamps/lock version, events/outbox, and idempotency.
- `REPAIRED` cannot complete without warranty; its start equals the single server handover timestamp. Non-repaired outcomes cannot create warranty.
- Disposition is consistent with final authoritative due and required notes.
- Signature media, when supplied, is uploaded, unexpired/eligible, same tenant/order, and allowed purpose.
- Same handover key/payload before TRACK expiry returns the original result and same usable tracking URL; key reuse with another payload is rejected; same-key replay after expiry returns `TOKEN_EXPIRED` without minting a token.
- Two concurrent handovers result in one immutable completion; the loser receives the contracted conflict/original idempotent result without partial rows.
- Active decision tokens and older tracking tokens are revoked. Exactly one new TRACK token can read its one customer-safe order and cannot decide a quote.
- TRACK expiry follows the frozen one-year/warranty-plus-30-day policy and `lastUsedAt` updates never extend it.
- Handover idempotency survives at least through TRACK expiry. Database response JSON, logs, audit, timeline, and domain-only outbox contain no raw token/full URL/destination/provider request, and no notification delivery is created.
- Failure injected at every persistence boundary rolls back payment/handover/warranty/token/status/event/outbox/idempotency together.
- No endpoint can complete an order from a state other than `READY_FOR_PICKUP` or mutate its completed workflow/handover/warranty history. A permitted later payment only appends a receipt and recalculates the read-model balance.

## Required tests

- Payment success for OWNER and RECEPTIONIST; TECHNICIAN, inactive membership, cross-tenant, missing/malformed idempotency key.
- No binding approval; every disallowed pre-handover state including repairing/re-quote; zero/negative/fractional amount; amount equal to due; overpayment; prior payments; valid `READY_FOR_PICKUP`; valid later payment after partial/pay-later completion; rejection after paid/waived completion or zero due; BigInt serialization; method/reference validation.
- Payment same-key retry, payload mismatch, concurrent sum exceeding due, event/idempotency failure rollback.
- Handover role/tenant/state matrix, stale `expectedLockVersion`, missing recipient/outcome, pre-existing handover, completed order.
- Each disposition with valid and invalid paid/due/note combinations, including embedded final payment, zero-balance `PAID`, and non-repaired/no-binding-approval zero/zero/zero with payment forbidden.
- Repaired handover missing warranty, invalid end/terms/client start, exact server timestamp equality; non-repaired handover with forbidden warranty.
- Signature media missing, cross-tenant/order, wrong purpose/MIME, incomplete/expired, valid binding, and transaction rollback after binding.
- Same-key handover retry across a fresh service instance, payload mismatch, two concurrent requests, and failure at payment, handover, warranty, token revoke/create, transition, event, outbox, or idempotency write.
- Old `DECIDE_QUOTE` and prior `TRACK_ORDER` tokens rejected after commit; exactly one new TRACK token read allowed and decision denied; foreign order/token rejected.
- TRACK expiry for repaired/non-repaired outcomes, warranty longer than one year, repeated reads without expiry extension, idempotency retention through expiry, same URL replay before expiry, and terminal `TOKEN_EXPIRED` without mint after expiry.
- Search database rows, captured structured logs, events, outbox, audit, and idempotency response for raw token/public URL/customer contact/private payment leakage.
- Domain outbox assertion: no destination/provider payload, adapter call, or `NotificationDelivery` row is produced.

## Definition of Done

- Payment amount due/disposition rules live in tested server domain/application code; controllers remain thin.
- Handover is the sole atomic path to `COMPLETED` and uses the RF-041 state-machine boundary.
- Warranty and public-token lifecycle follow the frozen RF-040 schema/contract with no raw-token persistence.
- Old tracking tokens are revoked, replay lifetime is bounded by the new token expiry, and expired replay cannot mint a replacement.
- Payment, handover, warranty, status, token, timeline/outbox, and idempotency rollback/concurrency behavior is proven by integration tests.
- The completion outbox is domain-only; no notification destination/provider delivery is introduced.
- No out-of-scope warranty follow-up, public mapping, UI, real provider, or contract/schema change is introduced.
- Format, lint, typecheck, unit tests, integration tests, full regression tests, build, migration deployment, and migration status pass.

## AI implementation prompt

```text
Bạn đang làm RF-047 — Idempotent payment and atomic handover API trong
C:\RepairFlow.

Đọc theo thứ tự: AGENTS.md, docs/tasks/milestone-5/README.md,
docs/tasks/milestone-5/RF-040-service-contract-persistence.md,
docs/tasks/milestone-5/RF-041-repair-execution-state-machine.md,
docs/tasks/milestone-5/RF-042-work-logs-parts-api.md,
docs/tasks/milestone-5/RF-045-qc-run-workflow-api.md,
docs/tasks/milestone-5/RF-047-payment-handover-api.md,
docs/tasks/milestone-4/RF-032-state-machine-foundation.md,
docs/tasks/milestone-4/RF-036-quote-send-token-outbox.md,
docs/tasks/milestone-4/RF-037-public-quote-read-decision.md,
docs/domain-rules.md, docs/architecture.md, docs/rbac.md,
docs/openapi.yaml, prisma/schema.prisma, docs/error-codes.md,
docs/testing-strategy.md; sau đó đọc implementation hiện tại của idempotency,
state machine, media verification, public token, outbox, repair-order detail và
RF-041/RF-045.

Trước khi code, tóm tắt:
- payment và handover request/response contract;
- cách lấy approvedTotal và công thức amountDue;
- disposition matrix;
- role, tenant, state, media, QC/readiness và optimistic-lock guards;
- transaction boundary từ optional payment đến COMPLETED;
- warranty snapshot và server handover timestamp;
- DECIDE_QUOTE/old TRACK revoke, new TRACK derivation/expiry/replay lifecycle;
- idempotency, concurrency, rollback, sensitive-data rules;
- file ownership và các file dự kiến thay đổi.

Sau đó triển khai POST payment idempotent và POST handover atomic theo RF.
Standalone payment chỉ ở READY_FOR_PICKUP; sau handover chỉ ở COMPLETED có
disposition PARTIALLY_PAID/PAY_LATER và amountDue > 0. Cấm payment trong
repairing/re-quote và mọi state khác. Lấy latest binding
QuoteApproval.approvedTotal làm authoritative total; tính
amountDue=max(0, approvedTotal-sum(payments)); từ chối overpayment. Non-repaired
không có binding approval phải trả approved=paid=due=0 và cấm mọi payment.

Handover chỉ từ READY_FOR_PICKUP, chỉ OWNER/RECEPTIONIST, tạo optional final
payment khi hợp lệ, handover, repaired-only warranty với startsAt bằng server
handedOverAt, revoke toàn bộ DECIDE_QUOTE và TRACK_ORDER cũ, tạo đúng một token
TRACK_ORDER mới, gọi state machine để COMPLETED và ghi timeline/domain-only
outbox/idempotency trong cùng transaction. Idempotency record phải sống ít nhất
đến TRACK expiry: replay trước expiry trả cùng URL; sau expiry trả TOKEN_EXPIRED
và không mint token. Outbox không có destination/provider call hoặc delivery.
Raw token/public URL chỉ được dựng trong memory và không được lưu hoặc log.

Không triển khai payment gateway/refund/accounting, warranty follow-up, public
warranty mapping, UI, real notification provider hoặc bất kỳ bypass QC/status
nào. Không sửa schema/OpenAPI/error contract RF-040 âm thầm; nếu thiếu hoặc mâu
thuẫn thì dừng phần phụ thuộc và báo rõ.

Viết đầy đủ test cho role/tenant/payment-state matrix, non-repaired zero totals,
totals/disposition, retry/mismatch, concurrent overpayment/handover, stale lock,
warranty, media, revoke token cũ, TRACK expiry/idempotency retention,
TOKEN_EXPIRED no-mint, raw-token absence, domain-only outbox và từng rollback
boundary. Chạy format, lint, typecheck, test, build và migration checks. Không
commit hoặc push.
```
