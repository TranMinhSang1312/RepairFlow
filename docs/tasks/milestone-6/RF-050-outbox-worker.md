# RF-050 — PostgreSQL outbox worker foundation

## Goal

Replace the heartbeat-only worker with a PostgreSQL-backed processor for outbox events that already contain one or more `NotificationDelivery` rows. The worker must claim safely across replicas, retry provider failures, reclaim expired leases, complete idempotently, and stop at a visible dead-letter state.

## Scope

- Worker environment for batch size, lease, maximum attempts, and retry bounds.
- Atomic claim using `FOR UPDATE SKIP LOCKED`.
- Stable claim ownership through `lockedBy` and `lockedAt`.
- Attempt increment at claim time, bounded exponential retry, lease recovery, and dead letter.
- Notification delivery handler with a stable provider idempotency key.
- Deterministic fake provider for local/test execution.
- Production rejects the fake provider; the real `email` mode is reserved for RF-051 and cannot silently fall back.
- Non-overlapping polling loop and graceful shutdown.
- PostgreSQL integration tests for concurrency and recovery.

## Outside scope

- Real SMTP/email, SMS, or Zalo calls.
- Resolving a plaintext destination or template from domain aggregates.
- Creating notification deliveries for domain-only events.
- Staff/owner operations API or UI.
- Manual retry, metrics dashboards, backup, restore, or AI jobs.
- Any API or OpenAPI change.

## Contract

1. Only allowlisted event types with a configured notification delivery are claimable. RF-050 enables `QUOTE_SENT`; later RFs extend the allowlist when their handlers exist.
2. Among those events, only due `PENDING`/`FAILED` rows or expired `PROCESSING` leases are claimable.
3. Claim increments `attempts`, writes `PROCESSING`, `lockedAt`, and `lockedBy` in the same transaction.
4. Candidates are ordered by `availableAt`, then ID, and claimed with `FOR UPDATE SKIP LOCKED`.
5. A completed delivery is never called again. If delivery was persisted as `SENT` before the outbox completion write, retry only completes the event.
6. Provider idempotency key is stable for `(outboxEventId, notificationDeliveryId)` across every retry.
7. Retry delay is `min(retryMaxMs, retryBaseMs * 2^(attempt-1))`.
8. The final failed attempt produces `DEAD_LETTER`; expired final-attempt leases are swept to the same state.
9. Persist and log only safe error codes. Provider messages, payloads, destinations, tokens, and credentials are excluded.
10. Domain-only events with no `NotificationDelivery` remain unchanged for RF-052.
11. `WORKER_NOTIFICATION_PROVIDER=fake` is valid only outside production. Selecting `email` before RF-051 fails startup explicitly.

## Files owned

- `apps/worker/src/**`
- `apps/worker/package.json`
- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `.env.example`
- `pnpm-lock.yaml`
- `docs/tasks/milestone-6/**`

No Prisma schema or OpenAPI change is required because `OutboxEvent` and `NotificationDelivery` already contain the required persistence fields.

## Acceptance criteria

- Two simultaneous workers collectively claim one event exactly once.
- Retry times follow bounded exponential backoff.
- A stale lease is reclaimed and its prior attempt remains counted.
- Maximum attempts transition the event to `DEAD_LETTER` with cleared lock fields.
- A `SENT` delivery is skipped and the outbox event completes without another provider call.
- Provider calls receive the same idempotency key on every attempt.
- Domain-only events are not claimed.
- Event types without an implemented handler are not claimed.
- Worker logs never serialize the outbox payload or an exception message.
- Polls never overlap and shutdown waits for the active poll before disconnecting.
- Format, lint, typecheck, test, and build pass.

## AI implementation prompt

You are implementing RF-050 in `C:\RepairFlow`. Read `AGENTS.md`, this file, `docs/product-spec.md`, `docs/domain-rules.md`, `docs/architecture.md`, `docs/testing-strategy.md`, `packages/config/src/index.ts`, `prisma/schema.prisma`, and the current worker source. Implement the PostgreSQL outbox worker foundation exactly as specified here. Keep provider behavior behind an interface and use a deterministic fake only; do not implement real email/SMS/Zalo, operations UI/API, AI, or a new queue service. Prove concurrent claim, retry, dead-letter, stale-lease recovery, idempotent completion, stable provider keys, domain-only exclusion, and log redaction with tests. Run format, lint, typecheck, all tests, and build. Do not commit or push unless explicitly requested.
