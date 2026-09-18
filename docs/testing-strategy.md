# RepairFlow Testing Strategy

## Goal

Tests protect business invariants, tenant isolation, authorization, binding customer actions, and provider failure behavior. Avoid tests that only mirror framework wiring or getters.

## Test layers

### Domain unit tests

Fast tests with no database for:

- Every allowed and rejected repair-order transition.
- Transition guard evaluation.
- Quote line and total calculation.
- Required/optional approval-group evaluation.
- QC overall-result derivation.
- Customer-safe timeline projection.
- AI output schema and prohibited-claim validation.

### Repository integration tests

Run against real PostgreSQL for:

- Composite tenant ownership and foreign keys.
- Unique order and quote version allocation under concurrency.
- Optimistic locking.
- Immutable-record service behavior.
- Transactional outbox atomicity.
- Idempotency record concurrency.
- Cursor pagination and indexes used by board queries.

Every new tenant-aware repository must include a negative shop-A/shop-B test.

### API integration tests

Boot the NestJS application with real PostgreSQL and fake external adapters:

- Authentication, session rotation, inactive membership.
- Role matrix for every mutation.
- Not-found behavior for cross-tenant IDs.
- DTO validation and stable error codes.
- Public token scope, expiry, revocation, and quote binding.
- Duplicate idempotent request behavior.
- Customer response redaction.

### Browser end-to-end tests

Keep a small critical suite:

1. Owner registration and shop creation.
2. Receptionist creates customer, device, and intake with photo.
3. Technician diagnoses assigned order.
4. Receptionist sends quote.
5. Customer accepts through public mobile page.
6. Technician records work and passes QC.
7. Receptionist records payment and handover.
8. Warranty follow-up creates a linked order.

Run critical flows at desktop and 360 px mobile viewport where applicable.

### Worker tests

- Claiming prevents two workers from processing one job concurrently.
- Retry uses bounded exponential backoff.
- Completed job is idempotent.
- Dead-letter status is visible after maximum attempts.
- Notification adapter receives no plaintext token in logs.
- AI timeout/failure leaves domain data unchanged.

## Mandatory security scenarios

- Shop A cannot read, search, mutate, download media, or infer existence of shop B data.
- Technician cannot act on an unassigned order.
- Customer token cannot access internal notes, costs, users, audit logs, or another order.
- `TRACK_ORDER` token cannot decide a quote.
- Old quote token cannot decide a new quote version.
- Token hashes, device credentials, and passwords never appear in logs or snapshots.
- Presigned upload/download requests enforce ownership, type, size, and short expiry.

## Test data

Seed deterministic fixtures:

- Two shops with overlapping customer names and device identifiers.
- Owner, receptionist, technician, inactive membership.
- One order in each workflow state.
- Current, expired, superseded, and decided quotes.
- Valid, expired, revoked, and wrong-scope public tokens.

Never use real customer information in tests or fixtures.

## CI gates

Pull requests must pass:

```text
format check
lint
typecheck
domain unit tests
repository/API integration tests affected by the change
build
```

Critical browser tests run before a release and on changes to intake, quote, public portal, QC, or handover flows.

## Release evidence

Each release records:

- Migration status and rollback/forward-fix plan.
- Test command results.
- OpenAPI compatibility check.
- Restore verification date for backups.
- Known limitations and feature-flag state.

