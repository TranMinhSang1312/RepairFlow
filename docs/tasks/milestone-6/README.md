# Milestone 6 — Notifications and operations

Milestone 6 turns the transactional outbox already written by business transactions into observable, retryable external work without adding Redis or microservices.

## RF order

1. `RF-050` — PostgreSQL outbox worker foundation: claim, lease, retry, idempotent completion, and dead letter.
2. `RF-051` — Email notification adapter and immutable destination/template resolution.
3. `RF-052` — Notification orchestration for quote, ready-for-pickup, handover, and staff invitation events.
4. `RF-053` — Owner operations API and UI for failed/dead-letter jobs and safe manual retry.
5. `RF-054` — Structured error tracking, worker metrics, health/readiness, and alert boundaries.
6. `RF-055` — Backup/restore runbook, restore drill evidence, and Milestone 6 final audit.

## Shared rules

- The business transaction owns outbox creation. A request path never calls a provider.
- PostgreSQL remains the queue for the MVP. Do not introduce Redis, BullMQ, or a microservice.
- Workers may process an event more than once. Every provider call receives a stable idempotency key.
- Claims use a bounded lease and `FOR UPDATE SKIP LOCKED`; a crashed worker cannot strand a job forever.
- Retry delay is bounded exponential backoff. Reaching the attempt limit produces `DEAD_LETTER`.
- Logs contain identifiers, attempt numbers, status, and safe error codes only. They never contain destinations, raw public tokens, credentials, payloads, or provider response bodies.
- Domain-only events without a configured delivery remain pending until a later RF owns their orchestration.
- `NotificationDelivery` records track channel delivery; `OutboxEvent` tracks execution of the durable job.

## Milestone exit criteria

- A committed business action cannot lose its pending notification.
- Two workers cannot actively own the same job.
- A stable provider idempotency key prevents duplicate binding messages during retry recovery.
- Exhausted work is visible as dead letter and can be operated safely by an owner after RF-053.
- Backup restore and operational evidence are documented and verified.
