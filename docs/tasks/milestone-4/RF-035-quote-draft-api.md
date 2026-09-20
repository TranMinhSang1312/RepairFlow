# RF-035 — Quote draft and authoritative totals API

## Objective

Allow owner or receptionist to create and revise a draft quote version with server-calculated integer-VND totals and concurrency-safe version numbering.

## Scope

- Implement create-next-draft endpoint.
- Implement draft-only replacement/update endpoint frozen by RF-030.
- Validate diagnosis reference, items, quantities, prices, optional flags, approval groups, discount, expiry, and customer note.
- Calculate line totals, subtotal, discount, and total on the server.
- Expose quote versions through repair-order detail for staff.

## Outside scope

- Sending/freezing, public tokens, customer decision, notifications, transitions, and UI.
- Deleting quote history or editing sent/terminal versions.

## Flow and transaction

- Create: validate order/state and optional same-order diagnosis; allocate next `versionNo`; insert version/items and event atomically.
- Update: lock/read tenant-owned quote; require `DRAFT`; replace editable item set and totals atomically; never change `versionNo`.
- All money is integer VND. Quantity supports positive hundredths; multiplication must use decimal-safe arithmetic and an explicitly documented rounding rule.

## Business and security rules

- Only owner/receptionist can create or edit drafts.
- Order must be in a quote-eligible state defined by domain rules.
- At least one item; positive quantity; non-negative unit price/discount; total cannot be negative.
- Diagnosis reference must belong to the same order/shop.
- Sent, accepted, declined, expired, or superseded quotes are immutable.
- Concurrent create requests cannot duplicate version numbers.

## API/UI involved

- `POST /api/v1/repair-orders/{repairOrderId}/quotes`
- `PATCH /api/v1/quotes/{quoteVersionId}`
- Extended staff repair-order detail quote history
- No UI in this RF.

## Expected files

- `apps/api/src/modules/quotes/*`
- `apps/api/src/modules/repair-orders/repair-orders.module.ts`
- Repair-order detail mapper/types
- `apps/api/test/quote-drafts.e2e.test.ts`

## Dependencies

- RF-030 and RF-033 merged.

## Acceptance criteria

- Owner/receptionist can create and update a valid draft.
- Returned totals are authoritative and reproducible.
- Client-supplied totals/status/version are rejected or ignored according to contract; never trusted.
- Wrong role, wrong state, foreign resource, invalid diagnosis, invalid approval grouping, and immutable quote fail cleanly.
- Concurrent creation produces unique sequential versions without partial item sets.

## Required tests

- Role and tenant matrix.
- Boundary quantities/prices/discounts and decimal-safe totals.
- Negative total prevention.
- Diagnosis ownership/order binding.
- Draft replacement rollback.
- Sent/terminal immutability.
- Concurrent version allocation.
- Sensitive field and BigInt JSON mapping.

## Definition of Done

- Money never uses floating-point arithmetic for stored/calculated VND.
- Controller is thin and repository queries are tenant-scoped.
- Format, lint, typecheck, integration tests, and build pass.

## AI implementation prompt

```text
Bạn đang làm RF-035 — Quote draft and authoritative totals API trong C:\RepairFlow.
Đọc AGENTS.md, docs/tasks/milestone-4/README.md,
docs/tasks/milestone-4/RF-035-quote-draft-api.md, docs/domain-rules.md,
docs/rbac.md, docs/openapi.yaml, prisma/schema.prisma,
docs/error-codes.md và docs/testing-strategy.md.

Trước khi code, tóm tắt create/update contract, quote-eligible states, money math,
approval groups, version concurrency, tenant rules và transaction. Sau đó triển
khai draft create/update, authoritative totals và staff detail mapping.

Không triển khai send, token, public decision, notification, transition hoặc UI.
Test role, tenant, diagnosis binding, money boundaries, negative total, immutable
quote, rollback và concurrent version allocation. Chạy format, lint, typecheck,
test và build. Không commit hoặc push.
```
