# RF-036 — Quote send, public token, and outbox transaction

## Objective

Freeze a draft quote into an immutable sent version, create a secure decision link, record durable side effects, and move the order to `AWAITING_APPROVAL` atomically.

## Scope

- Implement `POST /api/v1/quotes/{quoteVersionId}/send`.
- Recalculate and validate quote totals/items before freezing.
- Supersede prior active sent quote/token when allowed.
- Derive a high-entropy raw token through the keyed PRF contract from RF-030, store only its hash, and bind it to one order, quote version, scope, and expiry.
- Append timeline and outbox records.
- Use the RF-032 internal transition service inside the same transaction.
- Return a one-time public URL; support `COPY_LINK` without external delivery and a deterministic fake notification adapter boundary for other channels.

## Outside scope

- Actual provider delivery, retries/dead-letter operations, public page, customer decision, and quote editing.

## Transaction boundary

1. Resolve idempotency key/request hash.
2. Lock tenant-owned draft quote and order; verify owner/receptionist permission.
3. Validate non-empty items, expiry, customer destination requirements, and server totals.
4. Supersede/revoke any prior active sent quote/token according to domain rules.
5. Mark current version `SENT`, set `sentAt`, and freeze it.
6. Create the `DECIDE_QUOTE` token record, derive the raw token from stable metadata plus the server secret, and persist only its hash.
7. Transition order to `AWAITING_APPROVAL` through the state machine.
8. Append quote/timeline/outbox records and idempotent response.
9. Commit, then return the public URL containing the raw token.

## Business and security rules

- Only owner/receptionist can send.
- Raw token and full public URL must never be persisted in business tables, events, logs, or outbox payloads.
- Hash comparison must be timing-safe where applicable.
- A sent or terminal quote is immutable.
- Reusing the same idempotency key/payload derives and returns the same usable URL without storing plaintext; different payload is rejected.
- `COPY_LINK` creates no notification delivery. Other channels resolve the destination from the immutable intake customer snapshot and queue only destination hashes plus non-secret token metadata.
- Provider unavailability cannot roll back a committed quote send; delivery is represented by outbox state.

## API/UI involved

- `POST /api/v1/quotes/{quoteVersionId}/send`
- Internal state-machine API/service.
- Outbox and fake notification port.
- No UI in this RF.

## Expected files

- `apps/api/src/modules/quotes/*`
- `apps/api/src/modules/public-access/*`
- `apps/api/src/modules/notifications/*` for port/fake only
- Existing idempotency/state-machine modules
- `apps/api/test/quote-send.e2e.test.ts`

## Dependencies

- RF-032 and RF-035 merged.

## Acceptance criteria

- Valid send commits quote status, token hash, event, outbox, order transition, lock version, and idempotency atomically.
- Database and logs contain no raw public token.
- Prior active link becomes unusable when superseded.
- Retry and payload mismatch behavior are deterministic.
- External delivery failure does not undo the business transaction.

## Required tests

- Role, tenant, draft state, items, expiry, and destination guards.
- Same-key retry and different-payload conflict.
- Superseding old quote/token.
- Concurrent send.
- Rollback at every persistence boundary.
- Raw-token absence in database, event, outbox, and captured logs.
- Same-key retry returns the same URL across a fresh service instance while the configured derivation secret is unchanged.
- `COPY_LINK` and deterministic fake adapter behavior.

## Definition of Done

- Atomic send path and provider boundary implemented.
- No real network notification is sent.
- Format, lint, typecheck, tests, build, and migration checks pass.

## AI implementation prompt

```text
Bạn đang làm RF-036 — Quote send, public token, and outbox transaction trong
C:\RepairFlow. Đọc AGENTS.md, docs/tasks/milestone-4/README.md,
docs/tasks/milestone-4/RF-036-quote-send-token-outbox.md,
docs/domain-rules.md, docs/architecture.md, docs/rbac.md,
docs/openapi.yaml, prisma/schema.prisma, docs/error-codes.md và
docs/testing-strategy.md.

Trước khi code, tóm tắt send contract, immutability, supersede rule, token
lifecycle, idempotency, state transition, outbox và transaction boundary. Sau đó
triển khai send bằng một transaction và fake notification boundary.

Không triển khai public UI, customer decision, work, QC hoặc real provider. Test
role/tenant/state, retry, mismatch, supersede, concurrency, rollback, provider
failure và chứng minh raw token không nằm trong DB/log/event/outbox. Chạy mọi kiểm
tra phù hợp. Không commit hoặc push.
```
