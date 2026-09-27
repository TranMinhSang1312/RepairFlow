# RepairFlow observability runbook

## Probes

| Process | Liveness | Readiness | Metrics |
|---|---|---|---|
| API | `GET /api/v1/health/live` | `GET /api/v1/health/ready` | HTTP structured logs |
| Web | `GET /api/health` | same route for MVP | platform metrics |
| Worker | `GET :3002/health/live` | `GET :3002/health/ready` | `GET :3002/metrics` |

The worker operations port is internal. Do not publish it through the customer or staff ingress. Probes and metrics use `Cache-Control: no-store` and contain no business identifiers.

Liveness answers whether the process event loop is serving requests. Restart on repeated liveness failure. Readiness answers whether traffic/work should be assigned. API readiness requires PostgreSQL. Worker readiness requires PostgreSQL plus a successful poll no older than `WORKER_READINESS_STALE_MS`.

## Metrics

- `repairflow_worker_polls_total`
- `repairflow_worker_poll_failures_total`
- `repairflow_worker_claimed_total`
- `repairflow_worker_completed_total`
- `repairflow_worker_retried_total`
- `repairflow_worker_dead_lettered_total`
- `repairflow_worker_poll_in_flight`
- `repairflow_worker_consecutive_poll_failures`
- `repairflow_worker_last_success_unixtime_seconds`

Metrics have no tenant or record labels. Investigate individual failed jobs through the owner notification operations screen, whose response remains tenant-bound and allowlisted.

## Alert boundaries

Route structured `worker.alert` log events to the deployment alerting system.

- `OUTBOX_POLL_FAILURE_THRESHOLD`: emitted once when consecutive poll failures reach `WORKER_ALERT_FAILURE_THRESHOLD`; a successful poll re-arms it.
- `OUTBOX_DEAD_LETTER_THRESHOLD`: emitted for a poll whose new dead-letter count reaches `WORKER_ALERT_DEAD_LETTER_THRESHOLD`.
- Alert if worker readiness remains unavailable for two stale windows.
- Alert if `repairflow_worker_dead_lettered_total` increases or poll failures continue increasing.

Alerts must contain only the alert code, threshold and aggregate count. Never attach log context containing payload, destination, raw/public token, provider response, credentials, request body, stack or customer data.

## Triage

1. Check API and worker readiness component states.
2. Compare poll failure, retry and dead-letter counters.
3. Inspect safe worker logs by `errorCode`.
4. An owner may inspect and retry an eligible failed/dead-letter notification through RF-053.
5. If PostgreSQL is unavailable, restore it before retrying jobs. Provider calls remain outside request handling.
