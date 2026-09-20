# RF-037 — Public quote read and customer decision API

## Objective

Allow a customer without an account to safely view one token-bound order/quote and record one final, idempotent quote decision.

## Scope

- Implement public order/quote read using a hashed scoped token.
- Implement quote decision for accept, valid partial accept, or decline.
- Enforce token scope, expiry, revocation, quote/version binding, supersession, and finality.
- Calculate approved item snapshot and total on the server.
- Update quote state and transition the order atomically through RF-032.
- Append customer-safe timeline and outbox records.
- Apply public endpoint rate limits and log redaction.

## Outside scope

- Public UI, customer accounts, payment, repair work, provider delivery, and AI.

## Public read mapping

- Include shop display/contact approved by contract, order code, device display label, customer-safe status/timeline, and bound quote fields.
- Exclude customer contact data, intake/private notes, diagnosis details, internal costs, staff identities, audit data, request metadata, and object-storage information.
- Never echo the token.

## Decision transaction

1. Rate-limit and hash the token without logging it.
2. Resolve active token/quote/order and verify scope/expiry/revocation/supersession.
3. Resolve idempotency key and request hash.
4. Validate decision and required/optional approval-group selection.
5. Build immutable approved-item snapshot and authoritative approved total.
6. Insert one approval and update quote status/decided time.
7. Transition order: accepted/partial to `APPROVED`; declined to `READY_FOR_PICKUP` with `DECLINED_QUOTE`.
8. Append timeline/outbox and idempotent response; commit.

## Business and security rules

- Token binds to exactly one quote version and cannot access another resource.
- Required items must all be accepted; optional group constraints must hold.
- Optional items without a group are independently selectable; optional items sharing a group are all-or-none. The server applies the full quote discount once to the selected scope and floors the approved total at zero.
- A decision is final for that version.
- Invalid/revoked tokens do not reveal existence; expired/superseded behavior follows RF-030.
- Actor fingerprint must be privacy-preserving and must not store raw IP/user-agent strings unless the contract explicitly permits it.

## API/UI involved

- `GET /public/v1/orders/{token}`
- `POST /public/v1/quotes/{token}/decision`
- No UI in this RF.

## Expected files

- `apps/api/src/modules/public-portal/*`
- Quote/state-machine/idempotency integration points
- Public rate-limit configuration
- `apps/api/test/public-quote.e2e.test.ts`

## Dependencies

- RF-032 and RF-036 merged.

## Acceptance criteria

- Current valid token returns only public-safe data.
- Accepted, partially accepted, and declined decisions calculate the correct snapshot/total and state transition.
- Invalid, wrong-scope, expired, revoked, superseded, decided, and foreign-bound tokens cannot act.
- Same-key retry returns the original result; payload mismatch is rejected.
- Concurrent decisions create exactly one approval.

## Required tests

- Public-safe response allowlist and explicit sensitive-data assertions.
- Token state/scope/version matrix.
- Required/optional approval groups and approved totals.
- Accept/partial/decline transition outcomes.
- Idempotency, concurrency, finality, and rollback.
- Rate limit and token redaction in logs/errors.

## Definition of Done

- Public paths require no bearer or tenant header but authorize exclusively through the scoped token.
- All binding records are immutable and transactional.
- Format, lint, typecheck, tests, and build pass.

## AI implementation prompt

```text
Bạn đang làm RF-037 — Public quote read and customer decision API trong
C:\RepairFlow. Đọc AGENTS.md, docs/tasks/milestone-4/README.md,
docs/tasks/milestone-4/RF-037-public-quote-read-decision.md,
docs/domain-rules.md, docs/architecture.md, docs/rbac.md,
docs/openapi.yaml, prisma/schema.prisma, docs/error-codes.md và
docs/testing-strategy.md.

Trước khi code, tóm tắt public-safe allowlist, token lifecycle/scope, approval
groups, decision finality, idempotency, transitions và transaction boundary. Sau
đó triển khai public read và decision đúng contract.

Không triển khai UI, customer account, payment, work, QC hoặc real notification.
Test token matrix, sensitive-data exclusion, accept/partial/decline, approved
total, idempotency, concurrency, rate limit, rollback và log redaction. Chạy
format, lint, typecheck, test và build. Không commit hoặc push.
```
